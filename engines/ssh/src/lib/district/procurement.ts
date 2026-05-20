import { isConstructionSiteShell } from 'ssh/build-site'
import type {
	NpcSettlementTradeOffer,
	NpcSettlementTradeProfile,
} from 'ssh/commerce/settlement-trade'
import {
	setConstructionDeliveredGoods,
	setConstructionFoundationDeliveredGoods,
} from 'ssh/construction-state'
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

export interface DistrictGoodProcurementPolicy {
	readonly maxUnitPriceVp?: number
	readonly autoBuy?: boolean
}

export interface DistrictProcurementPolicy {
	autoBuyNeededGoods: boolean
	usePurchaseReserveVp: number
	bufferPurchaseReserveVp: number
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

export type DistrictPurchaseExecutionStatus =
	| 'ok'
	| 'not_found'
	| 'not_planned'
	| 'missing_target'
	| 'missing_storage'
	| 'insufficient_storage'
	| 'insufficient_funds'

export interface DistrictPurchaseExecutionResult {
	readonly status: DistrictPurchaseExecutionStatus
	readonly request?: DistrictPurchaseRequest
	readonly spentVp?: number
	readonly delivered?: number
}

/**
 * Compatibility-only district procurement model.
 *
 * Normal gameplay commerce is line-based: goods cross the player/NPC boundary only at
 * freight trade stops. These helpers stay to load older saves and support targeted
 * regression tests, but player-facing UI and ticking should not call them for direct buying.
 */

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
	},
	patch?: Partial<DistrictProcurementPolicy>
): DistrictProcurementPolicy {
	const goods: Partial<Record<GoodType, DistrictGoodProcurementPolicy>> = {}
	for (const [good, policy] of Object.entries(patch?.goods ?? {}) as [
		GoodType,
		DistrictGoodProcurementPolicy,
	][]) {
		goods[good] = {
			...goods[good],
			...policy,
			autoBuy: policy.autoBuy ?? goods[good]?.autoBuy,
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

export function listDistrictPurchaseRequests(
	game: Game,
	district: District
): DistrictPurchaseRequest[] {
	const demands = [...collectUseDemands(game, district), ...collectBufferDemands(game, district)]
	return demands.map((demand) => createPurchaseRequest(game, district, demand))
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

export function executeDistrictPurchaseRequest(
	game: Game,
	district: District,
	requestId: string
): DistrictPurchaseExecutionResult {
	const request = listDistrictPurchaseRequests(game, district).find(
		(candidate) => candidate.id === requestId
	)
	if (!request) return { status: 'not_found' }
	if (request.status !== 'planned') return { status: 'not_planned', request }
	if (!request.targetCoord) return { status: 'missing_target', request }
	const target = purchaseDeliveryTarget(game, request)
	if (!target) return { status: 'missing_target', request }
	if (!target.storage) return { status: 'missing_storage', request }
	if ((target.storage.hasRoom(request.good) ?? 0) < request.quantity) {
		return { status: 'insufficient_storage', request }
	}
	if (request.totalPriceVp === undefined || !game.canAffordVp(request.totalPriceVp)) {
		return { status: 'insufficient_funds', request }
	}
	if (!game.spendVp(request.totalPriceVp)) return { status: 'insufficient_funds', request }
	const delivered = target.storage.addGood(request.good, request.quantity)
	if (delivered !== request.quantity) {
		game.creditVp(request.totalPriceVp)
		return { status: 'insufficient_storage', request, delivered }
	}
	target.syncDelivered()
	return {
		status: 'ok',
		request,
		spentVp: request.totalPriceVp,
		delivered,
	}
}

export function executeDistrictAutomaticPurchases(
	game: Game,
	district: District
): DistrictPurchaseExecutionResult[] {
	if (!district.procurementPolicy.autoBuyNeededGoods) return []
	const results: DistrictPurchaseExecutionResult[] = []
	const attempted = new Set<string>()
	for (;;) {
		const request = listDistrictPurchaseRequests(game, district).find(
			(candidate) =>
				candidate.status === 'planned' &&
				district.procurementPolicy.goods[candidate.good]?.autoBuy === true &&
				!attempted.has(candidate.id)
		)
		if (!request) return results
		attempted.add(request.id)
		const result = executeDistrictPurchaseRequest(game, district, request.id)
		results.push(result)
		if (result.status !== 'ok') return results
	}
}

function collectUseDemands(game: Game, district: District): PurchaseDemand[] {
	return missingConstructionDemands(game, district)
}

function purchaseDeliveryTarget(game: Game, request: DistrictPurchaseRequest) {
	if (!request.targetCoord) return undefined
	const tile = game.hex.getTile(request.targetCoord)
	const content = tile?.content
	if (!content) return undefined
	if (request.purpose === 'buffer') {
		const storage = 'storage' in content ? content.storage : undefined
		return storage ? { storage, syncDelivered: () => {} } : undefined
	}
	if (isConstructionSiteShell(content)) {
		return {
			storage: content.storage,
			syncDelivered: () => {
				setConstructionDeliveredGoods(content.constructionSite, content.storage.stock ?? {})
			},
		}
	}
	const constructionSite =
		'constructionSite' in content ? content.constructionSite : undefined
	const foundationStorage =
		'foundationStorage' in content ? content.foundationStorage : undefined
	if (!constructionSite || !foundationStorage) return undefined
	return {
		storage: foundationStorage,
		syncDelivered: () => {
			setConstructionFoundationDeliveredGoods(constructionSite, foundationStorage.stock ?? {})
		},
	}
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
	const targets = districtStorageBufferTargets(game, district)
	const demands: PurchaseDemand[] = []
	for (const [good, target] of Object.entries(targets) as [GoodType, number][]) {
		const quantity = Math.max(0, Math.ceil(target - (stocked[good] ?? 0)))
		if (quantity <= 0) continue
		demands.push({
			good,
			quantity,
			purpose: 'buffer',
			targetCoord: firstStorageBufferTargetCoord(game, district, good),
		})
	}
	return demands.sort((left, right) => compareDemands(left, right))
}

function districtStorageBufferTargets(
	game: Game,
	district: District
): Partial<Record<GoodType, number>> {
	const targets: Partial<Record<GoodType, number>> = {}
	for (const coord of district.members) {
		const tile = game.hex.getTile(coord)
		const buffers =
			tile?.content && 'storageBuffers' in tile.content ? tile.content.storageBuffers : undefined
		for (const [good, qty] of Object.entries(buffers ?? {}) as [GoodType, number][]) {
			targets[good] = (targets[good] ?? 0) + Math.max(0, Math.floor(qty ?? 0))
		}
	}
	return targets
}

function firstStorageBufferTargetCoord(
	game: Game,
	district: District,
	good: GoodType
): AxialCoord | undefined {
	return district.members.find((coord) => {
		const tile = game.hex.getTile(coord)
		const buffers =
			tile?.content && 'storageBuffers' in tile.content ? tile.content.storageBuffers : undefined
		return (buffers?.[good] ?? 0) > 0
	})
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
	demand: PurchaseDemand
): DistrictPurchaseRequest {
	const base = {
		id: purchaseRequestId(district.id, demand),
		districtId: district.id,
		good: demand.good,
		quantity: demand.quantity,
		purpose: demand.purpose,
		targetCoord: demand.targetCoord,
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
