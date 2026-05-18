import { goods as goodsCatalog, settlementTrade } from 'engine-rules'
import type { Tile } from 'ssh/board/tile'
import type { Game } from 'ssh/game/game'
import type { InspectorSelectableObject } from 'ssh/game/object'
import type { GeneratedSettlement, GeneratedTileData, SettlementZonePlan } from 'ssh/generation'
import type { GoodType } from 'ssh/types'
import type { AxialCoord } from 'ssh/utils'
import { axial } from 'ssh/utils'
import { LCG } from 'ssh/utils/numbers'
import type { Position } from 'ssh/utils/position'

export type NpcTradeDirection = 'buy' | 'sell'

export interface NpcSettlementTradeOffer {
	readonly good: GoodType
	readonly direction: NpcTradeDirection
	readonly priceVp: number
	readonly label?: string
}

export interface NpcSettlementTradeProfile {
	readonly id: string
	readonly regionSetKey: string
	readonly name: string
	readonly kind: GeneratedSettlement['kind']
	readonly center: AxialCoord
	readonly radius: number
	readonly offers: readonly NpcSettlementTradeOffer[]
}

export const SETTLEMENT_TRADE_UID_PREFIX = 'settlement:'

const TRADE_GOODS = settlementTrade.goods as readonly GoodType[]
const CONSTRUCTION_GOODS = new Set<GoodType>(
	settlementTrade.constructionGoods as readonly GoodType[]
)

function goodBaseValue(good: GoodType): number {
	const raw = goodsCatalog[good as keyof typeof goodsCatalog]?.baseValueVp
	return Math.max(1, Math.round(typeof raw === 'number' ? raw : 1))
}

function sortedUniqueGoods(goods: Iterable<GoodType>): GoodType[] {
	return [...new Set(goods)].sort((a, b) => a.localeCompare(b))
}

function zoneCoordSet(coords: ReadonlyArray<readonly [number, number]> | undefined): Set<string> {
	return new Set((coords ?? []).map(([q, r]) => `${q},${r}`))
}

function rankGoods(args: {
	seed: number
	settlement: GeneratedSettlement
	tileData: readonly GeneratedTileData[]
	zones?: SettlementZonePlan['zones']
	direction: NpcTradeDirection
}): GoodType[] {
	const rnd = LCG('settlement-trade', args.seed, args.settlement.id, args.direction)
	const weights = settlementTrade.scoreWeights
	const harvest = zoneCoordSet(args.zones?.harvest)
	const industrial = zoneCoordSet(
		args.zones?.named.find((zone) => zone.id === 'industrial')?.coords
	)
	const scores = new Map<GoodType, number>()
	for (const good of TRADE_GOODS) scores.set(good, weights.initialBase + rnd(weights.initialJitter))

	for (const tile of args.tileData) {
		const distance = axial.distance(args.settlement.center, tile.coord)
		if (distance > args.settlement.radius + weights.nearbyRadiusExtra) continue
		const key = axial.key(tile.coord)
		if (args.direction === 'sell') {
			if (tile.terrain === 'forest' || harvest.has(key)) {
				scores.set('wood', (scores.get('wood') ?? 0) + weights.forestSellWood)
				scores.set('berries', (scores.get('berries') ?? 0) + weights.forestSellBerries)
				scores.set('mushrooms', (scores.get('mushrooms') ?? 0) + weights.forestSellMushrooms)
			}
			if (tile.terrain === 'rocky' || industrial.has(key) || tile.deposit?.type === 'rock') {
				scores.set('stone', (scores.get('stone') ?? 0) + weights.rockySellStone)
			}
		} else {
			for (const good of CONSTRUCTION_GOODS) {
				scores.set(good, (scores.get(good) ?? 0) + weights.buyConstructionGood)
			}
			if (args.settlement.kind !== 'village') {
				scores.set('berries', (scores.get('berries') ?? 0) + weights.nonVillageFoodBuy)
				scores.set('mushrooms', (scores.get('mushrooms') ?? 0) + weights.nonVillageFoodBuy)
			}
		}
	}

	return sortedUniqueGoods(TRADE_GOODS).sort((left, right) => {
		const byScore = (scores.get(right) ?? 0) - (scores.get(left) ?? 0)
		return byScore || left.localeCompare(right)
	})
}

function offerPrice(
	good: GoodType,
	direction: NpcTradeDirection,
	kind: GeneratedSettlement['kind']
) {
	const modifier = settlementTrade.priceMultipliers[direction][kind]
	return Math.max(1, Math.round(goodBaseValue(good) * modifier))
}

export function createNpcSettlementTradeProfile(args: {
	readonly seed: number
	readonly regionSetKey: string
	readonly settlement: GeneratedSettlement
	readonly tileData: readonly GeneratedTileData[]
	readonly zones?: SettlementZonePlan['zones']
}): NpcSettlementTradeProfile {
	const count = settlementTrade.offerCounts[args.settlement.kind]
	const sellGoods = rankGoods({ ...args, direction: 'sell' }).slice(0, count)
	const buyGoods = rankGoods({ ...args, direction: 'buy' }).slice(0, count)
	const offers: NpcSettlementTradeOffer[] = [
		...sellGoods.map((good) => ({
			good,
			direction: 'sell' as const,
			priceVp: offerPrice(good, 'sell', args.settlement.kind),
			label: 'Sells',
		})),
		...buyGoods.map((good) => ({
			good,
			direction: 'buy' as const,
			priceVp: offerPrice(good, 'buy', args.settlement.kind),
			label: 'Buys',
		})),
	]
	return {
		id: args.settlement.id,
		regionSetKey: args.regionSetKey,
		name: args.settlement.name,
		kind: args.settlement.kind,
		center: { ...args.settlement.center },
		radius: args.settlement.radius,
		offers,
	}
}

export function settlementTradeObjectUid(settlementId: string): string {
	return `${SETTLEMENT_TRADE_UID_PREFIX}${encodeURIComponent(settlementId)}`
}

export function isSettlementTradeObjectUid(uid: string): boolean {
	return uid.startsWith(SETTLEMENT_TRADE_UID_PREFIX)
}

export function settlementIdFromTradeObjectUid(uid: string): string | undefined {
	if (!isSettlementTradeObjectUid(uid)) return undefined
	const encoded = uid.slice(SETTLEMENT_TRADE_UID_PREFIX.length)
	return encoded ? decodeURIComponent(encoded) : undefined
}

export class SettlementTradeObject implements InspectorSelectableObject {
	readonly uid: string
	readonly logs: string[] = []

	constructor(
		readonly game: Game,
		readonly profile: NpcSettlementTradeProfile
	) {
		this.uid = settlementTradeObjectUid(profile.id)
	}

	get title(): string {
		return this.profile.name
	}

	get debugInfo(): Record<string, unknown> {
		return {
			id: this.profile.id,
			kind: this.profile.kind,
			center: this.profile.center,
			radius: this.profile.radius,
			buyOffers: this.profile.offers.filter((offer) => offer.direction === 'buy').length,
			sellOffers: this.profile.offers.filter((offer) => offer.direction === 'sell').length,
		}
	}

	get position(): Position {
		return this.profile.center
	}

	get tile(): Tile | undefined {
		return this.game.hex.getTile(this.profile.center)
	}

	get hoverObject(): Tile | undefined {
		return this.tile
	}
}

export function createSettlementTradeObjectForUid(
	game: Game,
	uid: string
): SettlementTradeObject | undefined {
	const settlementId = settlementIdFromTradeObjectUid(uid)
	if (!settlementId) return undefined
	const profile = game.getSettlementTradeProfile(settlementId)
	return profile ? new SettlementTradeObject(game, profile) : undefined
}
