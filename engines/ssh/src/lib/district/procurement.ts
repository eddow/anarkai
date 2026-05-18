import { isConstructionSiteShell } from 'ssh/build-site'
import type {
	NpcSettlementTradeOffer,
	NpcSettlementTradeProfile,
} from 'ssh/commerce/settlement-trade'
import type { District } from 'ssh/district/district'
import type { Game } from 'ssh/game/game'
import type { GoodType } from 'ssh/types/base'
import type { AxialCoord } from 'ssh/utils'
import { axial } from 'ssh/utils'

export type DistrictPurchasePurpose = 'use' | 'buffer'
export type DistrictPurchaseStatus = 'planned' | 'blocked'
export type DistrictPurchaseBlockReason =
	| 'auto_buy_disabled'
	| 'no_seller'
	| 'too_expensive'
	| 'reserve_limit'
	| 'in_flight_limit'

export interface DistrictGoodProcurementPolicy {
	readonly bufferTargetUnits?: number
	readonly maxUnitPriceVp?: number
}

export interface DistrictProcurementPolicy {
	autoBuyNeededGoods: boolean
	usePurchaseReserveVp: number
	bufferPurchaseReserveVp: number
	maxInFlightPerGood: number
	goods: Partial<Record<GoodType, DistrictGoodProcurementPolicy>>
}

export interface DistrictPurchaseRequest {
	readonly id: string
	readonly districtId: string
	readonly good: GoodType
	readonly quantity: number
	readonly purpose: DistrictPurchasePurpose
	readonly providerSettlementId?: string
	readonly unitPriceVp?: number
	readonly totalPriceVp?: number
	readonly targetCoord?: AxialCoord
	readonly status: DistrictPurchaseStatus
	readonly blockReason?: DistrictPurchaseBlockReason
}

interface PurchaseDemand {
	readonly good: GoodType
	readonly quantity: number
	readonly purpose: DistrictPurchasePurpose
	readonly targetCoord?: AxialCoord
}

interface SellerCandidate {
	readonly profile: NpcSettlementTradeProfile
	readonly offer: NpcSettlementTradeOffer
	readonly distance: number
}

export function createDistrictProcurementPolicy(
	defaults: {
		readonly autoBuyNeededGoods: boolean
		readonly usePurchaseReserveVp: number
		readonly bufferPurchaseReserveVp: number
		readonly maxInFlightPerGood: number
		readonly defaultBufferTargets?: Partial<Record<string, number>>
	},
	patch?: Partial<DistrictProcurementPolicy>
): DistrictProcurementPolicy {
	const goods: Partial<Record<GoodType, DistrictGoodProcurementPolicy>> = {}
	for (const [good, target] of Object.entries(defaults.defaultBufferTargets ?? {})) {
		goods[good as GoodType] = { bufferTargetUnits: Math.max(0, Math.floor(target ?? 0)) }
	}
	for (const [good, policy] of Object.entries(patch?.goods ?? {}) as [
		GoodType,
		DistrictGoodProcurementPolicy,
	][]) {
		goods[good] = {
			...goods[good],
			...policy,
			bufferTargetUnits:
				policy.bufferTargetUnits === undefined
					? goods[good]?.bufferTargetUnits
					: Math.max(0, Math.floor(policy.bufferTargetUnits)),
			maxUnitPriceVp:
				policy.maxUnitPriceVp === undefined
					? goods[good]?.maxUnitPriceVp
					: Math.max(0, Math.floor(policy.maxUnitPriceVp)),
		}
	}
	return {
		autoBuyNeededGoods: patch?.autoBuyNeededGoods ?? defaults.autoBuyNeededGoods,
		usePurchaseReserveVp: Math.max(
			0,
			Math.floor(patch?.usePurchaseReserveVp ?? defaults.usePurchaseReserveVp)
		),
		bufferPurchaseReserveVp: Math.max(
			0,
			Math.floor(patch?.bufferPurchaseReserveVp ?? defaults.bufferPurchaseReserveVp)
		),
		maxInFlightPerGood: Math.max(
			0,
			Math.floor(patch?.maxInFlightPerGood ?? defaults.maxInFlightPerGood)
		),
		goods,
	}
}

export function districtProcurementPolicyToPatch(
	policy: DistrictProcurementPolicy
): DistrictProcurementPolicy {
	return {
		autoBuyNeededGoods: policy.autoBuyNeededGoods,
		usePurchaseReserveVp: policy.usePurchaseReserveVp,
		bufferPurchaseReserveVp: policy.bufferPurchaseReserveVp,
		maxInFlightPerGood: policy.maxInFlightPerGood,
		goods: Object.fromEntries(
			Object.entries(policy.goods).map(([good, config]) => [good, { ...config }])
		) as Partial<Record<GoodType, DistrictGoodProcurementPolicy>>,
	}
}

export function updateDistrictProcurementPolicy(
	district: District,
	patch: Partial<DistrictProcurementPolicy>
): void {
	const next = createDistrictProcurementPolicy(district.game.procurementDefaults, {
		...district.procurementPolicy,
		...patch,
		goods: {
			...district.procurementPolicy.goods,
			...patch.goods,
		},
	})
	Object.assign(district.procurementPolicy, next)
	district.procurementPolicy.goods = next.goods
}

export function setDistrictProcurementGoodPolicy(
	district: District,
	good: GoodType,
	patch: DistrictGoodProcurementPolicy
): void {
	updateDistrictProcurementPolicy(district, {
		goods: {
			[good]: {
				...district.procurementPolicy.goods[good],
				...patch,
			},
		},
	})
}

export function listDistrictPurchaseRequests(
	game: Game,
	district: District
): DistrictPurchaseRequest[] {
	const demands = [...collectUseDemands(game, district), ...collectBufferDemands(game, district)]
	const plannedByGood = new Map<GoodType, number>()
	return demands.map((demand) => {
		const count = plannedByGood.get(demand.good) ?? 0
		const request = createPurchaseRequest(game, district, demand, count)
		if (request.status === 'planned') plannedByGood.set(demand.good, count + 1)
		return request
	})
}

export function listDistrictEligibleSellGoods(game: Game, district: District): GoodType[] {
	const goods = new Set<GoodType>()
	for (const coord of district.members) {
		const tile = game.hex.getTile(coord)
		for (const looseGood of tile?.availableGoods ?? []) goods.add(looseGood.goodType)
		const stock =
			tile?.content && 'storage' in tile.content ? tile.content.storage?.stock : undefined
		for (const [good, qty] of Object.entries(stock ?? {}) as [GoodType, number][]) {
			if ((qty ?? 0) > 0) goods.add(good)
		}
	}
	return [...goods].sort((left, right) => left.localeCompare(right))
}

function collectUseDemands(game: Game, district: District): PurchaseDemand[] {
	return missingConstructionDemands(game, district)
}

function missingConstructionDemands(game: Game, district: District): PurchaseDemand[] {
	const demands: PurchaseDemand[] = []
	for (const coord of district.members) {
		const tile = game.hex.getTile(coord)
		const content = tile?.content
		const constructionSite =
			content && 'constructionSite' in content ? content.constructionSite : undefined
		if (!constructionSite) continue
		const isShell = content ? isConstructionSiteShell(content) : false
		const required = isShell
			? constructionSite.requiredGoods
			: constructionSite.foundationRequiredGoods
		const delivered = isShell
			? constructionSite.deliveredGoods
			: constructionSite.foundationDeliveredGoods
		for (const [good, qty] of Object.entries(required) as [GoodType, number][]) {
			const quantity = Math.max(0, Math.ceil((qty ?? 0) - (delivered[good] ?? 0)))
			if (quantity <= 0) continue
			demands.push({
				good,
				quantity,
				purpose: 'use',
				targetCoord: { q: coord.q, r: coord.r },
			})
		}
	}
	return demands.sort((left, right) => compareDemands(left, right))
}

function collectBufferDemands(game: Game, district: District): PurchaseDemand[] {
	const stocked = districtStock(game, district)
	const demands: PurchaseDemand[] = []
	for (const [good, policy] of Object.entries(district.procurementPolicy.goods) as [
		GoodType,
		DistrictGoodProcurementPolicy,
	][]) {
		const target = Math.max(0, Math.floor(policy.bufferTargetUnits ?? 0))
		const quantity = Math.max(0, target - (stocked[good] ?? 0))
		if (quantity <= 0) continue
		demands.push({ good, quantity, purpose: 'buffer', targetCoord: district.members[0] })
	}
	return demands.sort((left, right) => compareDemands(left, right))
}

function districtStock(game: Game, district: District): Partial<Record<GoodType, number>> {
	const stock: Partial<Record<GoodType, number>> = {}
	for (const coord of district.members) {
		const tile = game.hex.getTile(coord)
		for (const looseGood of tile?.availableGoods ?? []) {
			stock[looseGood.goodType] = (stock[looseGood.goodType] ?? 0) + 1
		}
		const storageStock =
			tile?.content && 'storage' in tile.content ? tile.content.storage?.stock : undefined
		for (const [good, qty] of Object.entries(storageStock ?? {}) as [GoodType, number][]) {
			stock[good] = (stock[good] ?? 0) + Math.max(0, Math.floor(qty ?? 0))
		}
	}
	return stock
}

function createPurchaseRequest(
	game: Game,
	district: District,
	demand: PurchaseDemand,
	plannedCountForGood: number
): DistrictPurchaseRequest {
	const base = {
		id: purchaseRequestId(district.id, demand),
		districtId: district.id,
		good: demand.good,
		quantity: demand.quantity,
		purpose: demand.purpose,
		targetCoord: demand.targetCoord,
	}
	if (demand.purpose === 'use' && !district.procurementPolicy.autoBuyNeededGoods) {
		return { ...base, status: 'blocked', blockReason: 'auto_buy_disabled' }
	}
	if (plannedCountForGood >= district.procurementPolicy.maxInFlightPerGood) {
		return { ...base, status: 'blocked', blockReason: 'in_flight_limit' }
	}
	const seller = chooseSeller(game, demand.good, demand.targetCoord ?? district.members[0])
	if (!seller) return { ...base, status: 'blocked', blockReason: 'no_seller' }
	const totalPriceVp = seller.offer.priceVp * demand.quantity
	const goodPolicy = district.procurementPolicy.goods[demand.good]
	if (
		goodPolicy?.maxUnitPriceVp !== undefined &&
		seller.offer.priceVp > goodPolicy.maxUnitPriceVp
	) {
		return {
			...base,
			providerSettlementId: seller.profile.id,
			unitPriceVp: seller.offer.priceVp,
			totalPriceVp,
			status: 'blocked',
			blockReason: 'too_expensive',
		}
	}
	const reserve =
		demand.purpose === 'use'
			? district.procurementPolicy.usePurchaseReserveVp
			: district.procurementPolicy.bufferPurchaseReserveVp
	if (game.playerAccount.balanceVp - totalPriceVp < reserve) {
		return {
			...base,
			providerSettlementId: seller.profile.id,
			unitPriceVp: seller.offer.priceVp,
			totalPriceVp,
			status: 'blocked',
			blockReason: 'reserve_limit',
		}
	}
	return {
		...base,
		providerSettlementId: seller.profile.id,
		unitPriceVp: seller.offer.priceVp,
		totalPriceVp,
		status: 'planned',
	}
}

function chooseSeller(
	game: Game,
	good: GoodType,
	target: AxialCoord | undefined
): SellerCandidate | undefined {
	const candidates: SellerCandidate[] = []
	for (const profile of game.listSettlementTradeProfiles()) {
		const offer = profile.offers.find(
			(candidate) => candidate.direction === 'sell' && candidate.good === good
		)
		if (!offer) continue
		candidates.push({
			profile,
			offer,
			distance: target ? axial.distance(profile.center, target) : 0,
		})
	}
	return candidates.sort((left, right) => {
		return (
			left.offer.priceVp - right.offer.priceVp ||
			left.distance - right.distance ||
			left.profile.id.localeCompare(right.profile.id)
		)
	})[0]
}

function compareDemands(left: PurchaseDemand, right: PurchaseDemand): number {
	return (
		left.good.localeCompare(right.good) ||
		left.purpose.localeCompare(right.purpose) ||
		(left.targetCoord?.q ?? 0) - (right.targetCoord?.q ?? 0) ||
		(left.targetCoord?.r ?? 0) - (right.targetCoord?.r ?? 0)
	)
}

function purchaseRequestId(districtId: string, demand: PurchaseDemand): string {
	const target = demand.targetCoord ? `${demand.targetCoord.q},${demand.targetCoord.r}` : 'district'
	return `purchase:${districtId}:${demand.purpose}:${demand.good}:${target}`
}
