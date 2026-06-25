import { goods as goodsCatalog, settlementTrade } from 'engine-rules'
import type { Tile } from 'ssh/board/tile'
import type { Game } from 'ssh/game/game'
import { GameObject, type InspectorSelectableObject, withInteractive } from 'ssh/game/object'
import {
	type GeneratedSettlement,
	type GeneratedTileData,
	type SettlementZonePlan,
	selectSettlementCityHallPosition,
} from 'ssh/generation'
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

export interface NpcSettlementTradeTarget {
	readonly kind: 'city_hall'
	readonly name: string
	readonly position: AxialCoord
}

export interface NpcSettlementTradeProfile {
	readonly regionSetKey: string
	readonly name: string
	readonly kind: GeneratedSettlement['kind']
	readonly center: AxialCoord
	readonly radius: number
	readonly cityHall: NpcSettlementTradeTarget
	readonly offers: readonly NpcSettlementTradeOffer[]
}

const TRADE_GOODS = settlementTrade.goods as readonly GoodType[]
const CONSTRUCTION_GOODS = new Set<GoodType>(
	settlementTrade.constructionGoods as readonly GoodType[]
)
const BASIC_MATERIAL_GOODS = settlementTrade.basicMaterialGoods as readonly GoodType[]

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
	const harvest = zoneCoordSet(args.zones?.find((z) => z.type === 'harvest')?.coords)
	const industrial = zoneCoordSet(args.zones?.find((zone) => zone.name === 'Industrial')?.coords)
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

function offerPrice(good: GoodType, seed: number, settlement: GeneratedSettlement) {
	const modifier = settlementTrade.priceMultipliers[settlement.kind]
	const rnd = LCG('settlement-trade-price', seed, settlement.id, good)
	const jitter = 1 + (rnd(2) - 1) * settlementTrade.priceJitter
	return Math.max(1, Math.round(goodBaseValue(good) * modifier * jitter))
}

function directionalOffers(
	goods: readonly GoodType[],
	direction: NpcTradeDirection,
	seed: number,
	settlement: GeneratedSettlement
): NpcSettlementTradeOffer[] {
	return goods.map((good) => ({
		good,
		direction,
		priceVp: offerPrice(good, seed, settlement),
		label: direction === 'sell' ? 'Trades' : 'Trades',
	}))
}

export function createNpcSettlementTradeProfile(args: {
	readonly seed: number
	readonly regionSetKey: string
	readonly settlement: GeneratedSettlement
	readonly tileData: readonly GeneratedTileData[]
	readonly zones?: SettlementZonePlan['zones']
}): NpcSettlementTradeProfile {
	const count = settlementTrade.offerCounts[args.settlement.kind]
	const materialGoods = sortedUniqueGoods(BASIC_MATERIAL_GOODS)
	const materialSet = new Set(materialGoods)
	const sellGoods = rankGoods({ ...args, direction: 'sell' })
		.filter((good) => !materialSet.has(good))
		.slice(0, count)
	const buyGoods = rankGoods({ ...args, direction: 'buy' })
		.filter((good) => !materialSet.has(good))
		.slice(0, count)
	const offers: NpcSettlementTradeOffer[] = [
		...directionalOffers(materialGoods, 'sell', args.seed, args.settlement),
		...directionalOffers(materialGoods, 'buy', args.seed, args.settlement),
		...directionalOffers(sellGoods, 'sell', args.seed, args.settlement),
		...directionalOffers(buyGoods, 'buy', args.seed, args.settlement),
	]
	const cityHallPosition = selectSettlementCityHallPosition(args.settlement, args.tileData)
	return {
		regionSetKey: args.regionSetKey,
		name: args.settlement.name,
		kind: args.settlement.kind,
		center: { ...args.settlement.center },
		radius: args.settlement.radius,
		cityHall: {
			kind: 'city_hall',
			name: `${args.settlement.name} City Hall`,
			position: cityHallPosition,
		},
		offers,
	}
}

export class SettlementTradeObject
	extends withInteractive(GameObject)
	implements InspectorSelectableObject
{
	readonly profile: NpcSettlementTradeProfile

	constructor(game: Game, profile: NpcSettlementTradeProfile) {
		super(game)
		this.profile = profile
	}

	get title(): string {
		return this.profile.cityHall.name
	}

	get debugInfo(): Record<string, unknown> {
		return {
			name: this.profile.name,
			kind: this.profile.kind,
			center: this.profile.center,
			position: this.profile.cityHall.position,
			radius: this.profile.radius,
			buyOffers: this.profile.offers.filter((offer) => offer.direction === 'buy').length,
			sellOffers: this.profile.offers.filter((offer) => offer.direction === 'sell').length,
		}
	}

	get position(): Position {
		return this.profile.cityHall.position
	}

	get tile(): Tile {
		const tile = this.game.hex.getTile(this.profile.cityHall.position)
		if (!tile) throw new Error(`Missing city hall tile for settlement ${this.profile.name}`)
		return tile
	}

	get hoverObject(): Tile | undefined {
		return this.game.hex.getTile(this.profile.cityHall.position)
	}

	canInteract(_action: string): boolean {
		return true
	}
}
