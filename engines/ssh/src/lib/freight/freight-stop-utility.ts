import { commerce, freightLineHiveNeedPriorityWeight } from 'engine-rules'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import {
	distributeSegmentAllowsGoodTypeForSegment,
	type FreightDistributeRouteSegment,
	type FreightGatherRouteSegment,
	type FreightLineDefinition,
	type FreightStop,
	findDistributeRouteSegments,
	findGatherRouteSegments,
	freightLineStopOrder,
	freightZoneTiles,
	gatherSegmentAllowsGoodTypeForSegment,
} from 'ssh/freight/freight-line'
import {
	FREIGHT_LINE_ALL_GOOD_TYPES,
	type GoodSelectionPolicy,
	listGoodTypesMatchingSelectionPolicy,
} from 'ssh/freight/goods-selection-policy'
import type { FreightAdSource } from 'ssh/freight/priority-channel'
import type { Game } from 'ssh/game/game'
import type { Hive } from 'ssh/hive/hive'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import { isVehicleLineService } from 'ssh/population/vehicle/vehicle'
import type { GoodType } from 'ssh/types/base'
import type { ExchangePriority } from 'ssh/utils/advertisement'
import type { AxialCoord } from 'ssh/utils/axial'
import { toAxialCoord } from 'ssh/utils/position'
import { traces } from '../dev/debug.ts'
import { freightConstructionDemandTarget } from './construction-demand'

/** Per-good quantities for a stop (loose goods, stored goods, or need sink). */
export interface FreightStopGoodsSnapshot {
	readonly perGood: Readonly<Partial<Record<GoodType, number>>>
	/** Sum of {@link perGood} values. */
	readonly total: number
	/** Optional provenance for snapshots that come from one concrete ad / policy channel. */
	readonly adSource?: FreightAdSource
}

/** Optional per-good priority metadata for hive need sinks. */
export interface FreightHiveNeedSinkMeta {
	readonly perGoodPriority: Readonly<Partial<Record<GoodType, ExchangePriority>>>
}

/**
 * Downstream line lookahead for the stops after the currently served stop.
 *
 * - `furtherNeededGoods`: goods that must already be available before leaving the current stop.
 * - `furtherProvidedGoods`: goods that later stops can still provide for even later unloads.
 * - `furtherTransferredGoods`: goods whose later provision can already be matched with a later unload.
 */
export interface FreightLineFurtherGoodsSnapshot {
	readonly furtherNeededGoods: FreightStopGoodsSnapshot
	readonly furtherProvidedGoods: FreightStopGoodsSnapshot
	readonly furtherTransferredGoods: FreightStopGoodsSnapshot
}

/**
 * Projection of current vehicle cargo against downstream need.
 *
 * - `reservedLoadedGoods`: current cargo still worth keeping for later unloads.
 * - `remainingNeededGoods`: additional cargo still worth loading now.
 * - `surplusLoadedGoods`: current cargo safe to unload as surplus.
 */
export interface FreightProjectedLoadedGoodsSnapshot {
	readonly reservedLoadedGoods: FreightStopGoodsSnapshot
	readonly remainingNeededGoods: FreightStopGoodsSnapshot
	readonly surplusLoadedGoods: FreightStopGoodsSnapshot
}

/**
 * Route-order future transfer intent for a vehicle at a line stop.
 *
 * This is the one place where cyclicity matters: callers receive already-ordered future counters and
 * should not need to branch on `line.cyclic` again.
 */
export interface FreightFutureTransferSnapshot {
	readonly routeNeedGoods: FreightStopGoodsSnapshot
	readonly routeSupplyGoods: FreightStopGoodsSnapshot
	readonly routeTransferredGoods: FreightStopGoodsSnapshot
}

export type FreightStopCommerceKind = 'bay' | 'named-zone' | 'radius-zone' | 'settlement-trade'

export type FreightStopCommerceBlockReason =
	| 'no_vehicle'
	| 'vehicle_full'
	| 'no_downstream_demand'
	| 'buffer_full'
	| 'no_matching_settlement_offer'
	| 'reserve_blocks_import'
	| 'policy_blocks_good'

export type FreightStopServicePositionKind = 'center' | 'border' | 'unreachable'

export interface FreightStopServicePositionExplanation {
	readonly kind: FreightStopServicePositionKind
	readonly label: string
	readonly targetCoord?: AxialCoord
	readonly borderCount?: number
	readonly sampleBorderCoord?: AxialCoord
}

export interface FreightStopCommerceExplanation {
	readonly stopKind: FreightStopCommerceKind
	readonly servicePosition: FreightStopServicePositionExplanation
	readonly localProvidedGoods: FreightStopGoodsSnapshot
	readonly localNeededGoods: FreightStopGoodsSnapshot
	readonly downstreamDemandGoods: FreightStopGoodsSnapshot
	readonly importOpportunityGoods: FreightStopGoodsSnapshot
	readonly exportOpportunityGoods: FreightStopGoodsSnapshot
	readonly retainedCargoGoods: FreightStopGoodsSnapshot
	readonly surplusCargoGoods: FreightStopGoodsSnapshot
	readonly minBalanceAfterBuyVp?: number
	readonly blockReasons: readonly FreightStopCommerceBlockReason[]
}

function sumRecord(values: Partial<Record<GoodType, number>>): number {
	let s = 0
	for (const v of Object.values(values)) {
		if (typeof v === 'number' && v > 0) s += v
	}
	return s
}

function addBlockReason(
	reasons: FreightStopCommerceBlockReason[],
	reason: FreightStopCommerceBlockReason
): void {
	if (!reasons.includes(reason)) reasons.push(reason)
}

function finiteGoodsCounts(
	values: Partial<Record<GoodType, number>>
): Partial<Record<GoodType, number>> {
	const out: Partial<Record<GoodType, number>> = {}
	for (const [goodType, quantity] of Object.entries(values) as [GoodType, number | undefined][]) {
		if (quantity === undefined || quantity <= 0) continue
		out[goodType] = Number.isFinite(quantity) ? quantity : Number.MAX_SAFE_INTEGER
	}
	return out
}

function freightStopKind(stop: FreightStop): FreightStopCommerceKind {
	if ('anchor' in stop) return 'bay'
	if ('trade' in stop) return 'settlement-trade'
	return stop.zone.kind === 'named' ? 'named-zone' : 'radius-zone'
}

function freightStopTargetTile(game: Game, stop: FreightStop): Tile | undefined {
	if ('anchor' in stop) {
		return game.hex.getTile({ q: stop.anchor.coord[0], r: stop.anchor.coord[1] })
	}
	if ('trade' in stop) {
		const position = game.getSettlementTradeProfile(stop.trade.settlementId)?.cityHall?.position
		return position ? game.hex.getTile(position) : undefined
	}
	if (stop.zone.kind === 'radius') {
		return game.hex.getTile({ q: stop.zone.center[0], r: stop.zone.center[1] })
	}
	return undefined
}

function explainFreightStopServicePosition(
	game: Game,
	stop: FreightStop
): FreightStopServicePositionExplanation {
	const tile = freightStopTargetTile(game, stop)
	const targetCoord = tile ? toAxialCoord(tile.position) : undefined
	if (!tile || !targetCoord) {
		return {
			kind: 'unreachable',
			label: 'service target unavailable',
		}
	}
	if (!tile.isBlockingSpace) {
		return {
			kind: 'center',
			label: 'center service',
			targetCoord,
		}
	}
	const serviceBorders = tile.neighborTiles
		.filter((neighbor) => !neighbor.isBlockingSpace)
		.map((neighbor) => tile.borderWith(neighbor))
		.filter((border): border is NonNullable<ReturnType<Tile['borderWith']>> => !!border)
	const sampleBorderCoord = serviceBorders[0] ? toAxialCoord(serviceBorders[0].position) : undefined
	return {
		kind: serviceBorders.length > 0 ? 'border' : 'unreachable',
		label: serviceBorders.length > 0 ? 'border service' : 'no service border',
		targetCoord,
		borderCount: serviceBorders.length,
		sampleBorderCoord,
	}
}

function freightStopReserve(line: FreightLineDefinition, stop: FreightStop): number {
	return Math.max(
		0,
		Math.floor(
			stop.minBalanceAfterBuyVp ??
				line.minBalanceAfterBuyVp ??
				commerce.procurement.bufferPurchaseReserveVp
		)
	)
}

/** Copy a goods map while dropping non-positive / non-finite quantities. */
export function normalizeGoodsCounts(
	values: Partial<Record<GoodType, number>>
): Partial<Record<GoodType, number>> {
	const normalized: Partial<Record<GoodType, number>> = {}
	for (const [goodType, quantity] of Object.entries(values) as [GoodType, number | undefined][]) {
		if (!Number.isFinite(quantity) || quantity === undefined || quantity <= 0) continue
		normalized[goodType] = quantity
	}
	return normalized
}

/** Turns a raw per-good map into a stable goods snapshot. */
export function snapshotFromGoodsCounts(
	map: Partial<Record<GoodType, number>>,
	adSource?: FreightAdSource
): FreightStopGoodsSnapshot {
	const perGood = normalizeGoodsCounts(map)
	return { perGood, total: sumRecord(perGood), adSource }
}

/** Per-good additive merge. */
export function addGoodsCounts(
	left: Partial<Record<GoodType, number>>,
	right: Partial<Record<GoodType, number>>
): Partial<Record<GoodType, number>> {
	const out = normalizeGoodsCounts(left)
	for (const [goodType, quantity] of Object.entries(normalizeGoodsCounts(right)) as [
		GoodType,
		number,
	][]) {
		out[goodType] = (out[goodType] ?? 0) + quantity
	}
	return out
}

/** Per-good `left - right`, floored at `0`. */
export function subtractGoodsCounts(
	left: Partial<Record<GoodType, number>>,
	right: Partial<Record<GoodType, number>>
): Partial<Record<GoodType, number>> {
	const out: Partial<Record<GoodType, number>> = {}
	const goods = new Set<GoodType>([
		...(Object.keys(left) as GoodType[]),
		...(Object.keys(right) as GoodType[]),
	])
	for (const goodType of goods) {
		const remaining = (left[goodType] ?? 0) - (right[goodType] ?? 0)
		if (remaining > 0) out[goodType] = remaining
	}
	return out
}

/** Per-good `min(left, right)` intersection. */
export function intersectGoodsCounts(
	left: Partial<Record<GoodType, number>>,
	right: Partial<Record<GoodType, number>>
): Partial<Record<GoodType, number>> {
	const out: Partial<Record<GoodType, number>> = {}
	const goods = new Set<GoodType>([
		...(Object.keys(left) as GoodType[]),
		...(Object.keys(right) as GoodType[]),
	])
	for (const goodType of goods) {
		const quantity = Math.min(left[goodType] ?? 0, right[goodType] ?? 0)
		if (quantity > 0) out[goodType] = quantity
	}
	return out
}

function filterAllowedGoods(
	goods: readonly GoodType[],
	policy: GoodSelectionPolicy | undefined
): GoodType[] {
	if (!policy) return [...goods]
	const allowed = new Set(listGoodTypesMatchingSelectionPolicy(policy, goods))
	return goods.filter((goodType) => allowed.has(goodType))
}

function anchorHiveForStop(game: Game, stop: FreightStop): Hive | undefined {
	if (!('anchor' in stop) || stop.anchor.kind !== 'alveolus') return undefined
	const tile = game.hex.getTile({ q: stop.anchor.coord[0], r: stop.anchor.coord[1] })
	const content = tile?.content
	if (!(content instanceof Alveolus)) return undefined
	return content.hive
}

function gatherLoadSegmentForStop(
	line: FreightLineDefinition,
	stopIndex: number
): FreightGatherRouteSegment | undefined {
	return findGatherRouteSegments(line).find((segment) => segment.loadStopIndex === stopIndex)
}

function gatherUnloadSegmentForStop(
	line: FreightLineDefinition,
	stopIndex: number
): FreightGatherRouteSegment | undefined {
	return findGatherRouteSegments(line).find((segment) => segment.unloadStopIndex === stopIndex)
}

function distributeLoadSegmentForStop(
	line: FreightLineDefinition,
	stopIndex: number
): FreightDistributeRouteSegment | undefined {
	return findDistributeRouteSegments(line).find((segment) => segment.loadStopIndex === stopIndex)
}

function distributeUnloadSegmentForStop(
	line: FreightLineDefinition,
	stopIndex: number
): FreightDistributeRouteSegment | undefined {
	return findDistributeRouteSegments(line).find((segment) => segment.unloadStopIndex === stopIndex)
}

function allowedGoodsProvidedAtStop(line: FreightLineDefinition, stopIndex: number): GoodType[] {
	const stop = line.stops[stopIndex]
	if (stop?.loadSelection) {
		return listGoodTypesMatchingSelectionPolicy(stop.loadSelection, FREIGHT_LINE_ALL_GOOD_TYPES)
	}
	if (stop && 'trade' in stop) return [...FREIGHT_LINE_ALL_GOOD_TYPES]
	const gatherSegment = gatherLoadSegmentForStop(line, stopIndex)
	if (gatherSegment) return listGoodsAllowedOnGatherSegment(line, gatherSegment)
	const distributeSegment = distributeLoadSegmentForStop(line, stopIndex)
	if (distributeSegment) return listGoodsAllowedOnDistributeSegment(line, distributeSegment)
	if (stop && 'anchor' in stop) return [...FREIGHT_LINE_ALL_GOOD_TYPES]
	return []
}

function allowedGoodsNeededAtStop(
	line: FreightLineDefinition,
	stopIndex: number,
	stop: FreightStop
): GoodType[] {
	if (stop.unloadSelection) {
		return listGoodTypesMatchingSelectionPolicy(stop.unloadSelection, FREIGHT_LINE_ALL_GOOD_TYPES)
	}
	if ('trade' in stop) return [...FREIGHT_LINE_ALL_GOOD_TYPES]
	const gatherSegment = gatherUnloadSegmentForStop(line, stopIndex)
	if (gatherSegment) {
		return filterAllowedGoods(
			listGoodsAllowedOnGatherSegment(line, gatherSegment),
			stop.unloadSelection
		)
	}
	const distributeSegment = distributeUnloadSegmentForStop(line, stopIndex)
	if (distributeSegment) {
		return filterAllowedGoods(
			listGoodsAllowedOnDistributeSegment(line, distributeSegment),
			stop.unloadSelection
		)
	}
	if ('anchor' in stop) return [...FREIGHT_LINE_ALL_GOOD_TYPES]
	return []
}

/** All good types allowed on the gather segment load policy (segment-aware). */
export function listGoodsAllowedOnGatherSegment(
	line: FreightLineDefinition,
	segment: FreightGatherRouteSegment
): GoodType[] {
	return FREIGHT_LINE_ALL_GOOD_TYPES.filter((g) =>
		gatherSegmentAllowsGoodTypeForSegment(line, segment, g)
	)
}

/** All good types allowed on the distribute segment load policy (segment-aware). */
export function listGoodsAllowedOnDistributeSegment(
	line: FreightLineDefinition,
	segment: FreightDistributeRouteSegment
): GoodType[] {
	return FREIGHT_LINE_ALL_GOOD_TYPES.filter((g) =>
		distributeSegmentAllowsGoodTypeForSegment(line, segment, g)
	)
}

/** Tiles whose center is within `radius` hex steps of `center` (inclusive). */
export function listTilesInAxialRadius(game: Game, center: AxialCoord, radius: number): Tile[] {
	return [...game.hex.tilesAround(center, radius)]
}

/**
 * Zone **source**: available loose goods in the radius (filtered by allowed goods).
 */
export function measureZoneLooseGoodsSource(
	game: Game,
	center: AxialCoord,
	radius: number,
	allowedGoods: ReadonlySet<GoodType>
): FreightStopGoodsSnapshot {
	const perGood: Partial<Record<GoodType, number>> = {}
	for (const tile of listTilesInAxialRadius(game, center, radius)) {
		for (const loose of tile.availableGoods) {
			if (!loose.available || loose.isRemoved) continue
			const gt = loose.goodType as GoodType
			if (!allowedGoods.has(gt)) continue
			perGood[gt] = (perGood[gt] ?? 0) + 1
		}
	}
	return snapshotFromGoodsCounts(perGood, 'vehicle-station')
}

/**
 * Zone **sink**: standalone construction {@link ConstructionSiteShell.remainingNeeds} on tiles in the radius.
 * (Tile-level “loose need” for material delivery.)
 */
export function measureZoneStandaloneConstructionNeedSink(
	game: Game,
	center: AxialCoord,
	radius: number,
	allowedGoods: ReadonlySet<GoodType>
): FreightStopGoodsSnapshot {
	const perGood: Partial<Record<GoodType, number>> = {}
	for (const tile of listTilesInAxialRadius(game, center, radius)) {
		const site = freightConstructionDemandTarget(tile.content)
		if (!site || site.destroyed || site.isReady) continue
		for (const g of allowedGoods) {
			const need = site.effectiveRemainingNeeds[g]
			if (need === undefined || need <= 0) continue
			perGood[g] = (perGood[g] ?? 0) + need
		}
	}
	return snapshotFromGoodsCounts(perGood, 'project')
}

function sumHiveStorageAvailableForGood(hive: Hive, goodType: GoodType): number {
	let sum = 0
	for (const alv of hive.generalStorages) {
		const a = alv.storage.available(goodType)
		if (a > 0) sum += a
	}
	return sum
}

/**
 * Hive **source**: summed {@link Storage.available} across {@link Hive.generalStorages} for allowed goods.
 * Bays draw from whole-hive logistics stock (per design).
 */
export function measureHiveStoredGoodsSource(
	hive: Hive,
	allowedGoods: ReadonlySet<GoodType>
): FreightStopGoodsSnapshot {
	const perGood: Partial<Record<GoodType, number>> = {}
	for (const g of allowedGoods) {
		const q = sumHiveStorageAvailableForGood(hive, g)
		if (q > 0) perGood[g] = q
	}
	return snapshotFromGoodsCounts(perGood, 'hive')
}

function sumHiveStorageHasRoomForGood(hive: Hive, goodType: GoodType): number {
	let sum = 0
	for (const alv of hive.generalStorages) {
		const relation = alv.workingGoodsRelations[goodType]
		if (relation?.advertisement !== 'demand') continue
		if (relation.priority !== '1-buffer' && relation.priority !== '2-use') continue
		const acceptedRoomFor = (
			alv as {
				acceptedRoomFor?: (goodType: GoodType, priority: ExchangePriority) => number
			}
		).acceptedRoomFor
		let room = acceptedRoomFor
			? acceptedRoomFor.call(alv, goodType, relation.priority)
			: (alv.storage.hasRoom(goodType) ?? 0)
		if (relation.priority === '1-buffer') {
			const buffer = (alv as { storageBuffers?: Partial<Record<GoodType, number>> })
				.storageBuffers?.[goodType]
			if (buffer !== undefined) {
				const planned = (alv.storage.stock[goodType] ?? 0) + alv.storage.allocated(goodType)
				room = Math.min(room, Math.max(0, buffer - planned))
			}
		}
		if (room > 0) sum += room
	}
	return sum
}

/**
 * Hive **sink** for unloading using raw room quantities. Only `2-use` / `1-buffer` needs count.
 */
export function measureHiveNeedRoomSink(
	hive: Hive,
	allowedGoods: ReadonlySet<GoodType>
): FreightStopGoodsSnapshot & { meta: FreightHiveNeedSinkMeta } {
	const needs = hive.needs
	const perGood: Partial<Record<GoodType, number>> = {}
	const perGoodPriority: Partial<Record<GoodType, ExchangePriority>> = {}
	for (const g of allowedGoods) {
		const pr = needs[g]
		if (pr !== '1-buffer' && pr !== '2-use') continue
		const room = sumHiveStorageHasRoomForGood(hive, g)
		if (room > 0) {
			perGood[g] = room
			perGoodPriority[g] = pr
		}
	}
	return {
		...snapshotFromGoodsCounts(perGood, 'hive'),
		meta: { perGoodPriority },
	}
}

/**
 * Hive **utility sink** for unloading: same goods as {@link measureHiveNeedRoomSink}, but weighted by
 * `2-use` / `1-buffer` priority for scalar utility scoring.
 */
export function measureHiveNeedSink(
	hive: Hive,
	allowedGoods: ReadonlySet<GoodType>
): FreightStopGoodsSnapshot & { meta: FreightHiveNeedSinkMeta } {
	const base = measureHiveNeedRoomSink(hive, allowedGoods)
	const perGood: Partial<Record<GoodType, number>> = {}
	for (const [goodType, quantity] of Object.entries(base.perGood) as [GoodType, number][]) {
		const priority = base.meta.perGoodPriority[goodType]
		if (priority !== '1-buffer' && priority !== '2-use') continue
		perGood[goodType] = quantity * freightLineHiveNeedPriorityWeight[priority]
	}
	return {
		...snapshotFromGoodsCounts(perGood, 'hive'),
		meta: base.meta,
	}
}

/** Measures goods that the line can pick up at the given stop. */
export function measureFreightStopProvidedGoods(
	game: Game,
	line: FreightLineDefinition,
	stopIndex: number
): FreightStopGoodsSnapshot {
	const stop = line.stops[stopIndex]
	if (!stop) return snapshotFromGoodsCounts({})
	const allowedGoods = allowedGoodsProvidedAtStop(line, stopIndex)
	if (allowedGoods.length === 0) return snapshotFromGoodsCounts({})
	const allowedGoodsSet = new Set(allowedGoods)
	if ('trade' in stop) {
		const profile = game.getSettlementTradeProfile(stop.trade.settlementId)
		const perGood: Partial<Record<GoodType, number>> = {}
		for (const offer of profile?.offers ?? []) {
			if (offer.direction !== 'sell') continue
			if (!allowedGoodsSet.has(offer.good)) continue
			perGood[offer.good] = Number.MAX_SAFE_INTEGER
		}
		return snapshotFromGoodsCounts(perGood, 'vehicle-station')
	}
	if ('zone' in stop) {
		if (stop.zone.kind === 'radius') {
			return measureZoneLooseGoodsSource(
				game,
				{ q: stop.zone.center[0], r: stop.zone.center[1] },
				stop.zone.radius,
				allowedGoodsSet
			)
		}
		const perGood: Partial<Record<GoodType, number>> = {}
		for (const tile of freightZoneTiles(game, stop.zone)) {
			for (const loose of tile.availableGoods) {
				if (!loose.available || loose.isRemoved) continue
				const gt = loose.goodType as GoodType
				if (!allowedGoodsSet.has(gt)) continue
				perGood[gt] = (perGood[gt] ?? 0) + 1
			}
		}
		return snapshotFromGoodsCounts(perGood, 'vehicle-station')
	}
	const hive = anchorHiveForStop(game, stop)
	if (!hive) return snapshotFromGoodsCounts({})
	return measureHiveStoredGoodsSource(hive, allowedGoodsSet)
}

/** Measures goods that the line can unload / consume at the given stop. */
export function measureFreightStopNeededGoods(
	game: Game,
	line: FreightLineDefinition,
	stopIndex: number
): FreightStopGoodsSnapshot {
	const stop = line.stops[stopIndex]
	if (!stop) return snapshotFromGoodsCounts({})
	const allowedGoods = allowedGoodsNeededAtStop(line, stopIndex, stop)
	if (allowedGoods.length === 0) return snapshotFromGoodsCounts({})
	const allowedGoodsSet = new Set(allowedGoods)
	if ('trade' in stop) {
		const profile = game.getSettlementTradeProfile(stop.trade.settlementId)
		const perGood: Partial<Record<GoodType, number>> = {}
		for (const offer of profile?.offers ?? []) {
			if (offer.direction !== 'buy') continue
			if (!allowedGoodsSet.has(offer.good)) continue
			perGood[offer.good] = Number.MAX_SAFE_INTEGER
		}
		return snapshotFromGoodsCounts(perGood, 'vehicle-station')
	}
	if ('zone' in stop) {
		if (stop.zone.kind === 'radius') {
			return measureZoneStandaloneConstructionNeedSink(
				game,
				{ q: stop.zone.center[0], r: stop.zone.center[1] },
				stop.zone.radius,
				allowedGoodsSet
			)
		}
		const perGood: Partial<Record<GoodType, number>> = {}
		for (const tile of freightZoneTiles(game, stop.zone)) {
			const site = freightConstructionDemandTarget(tile.content)
			if (!site || site.destroyed || site.isReady) continue
			for (const g of allowedGoodsSet) {
				const need = site.effectiveRemainingNeeds[g]
				if (need === undefined || need <= 0) continue
				perGood[g] = (perGood[g] ?? 0) + need
			}
		}
		return snapshotFromGoodsCounts(perGood, 'project')
	}
	const hive = anchorHiveForStop(game, stop)
	if (!hive) return snapshotFromGoodsCounts({})
	return measureHiveNeedRoomSink(hive, allowedGoodsSet)
}

/**
 * Computes the doc's downstream `further-*` collections by traversing the remaining stop suffix.
 *
 * Need is processed before provide at the same stop, so goods loaded later cannot retroactively satisfy
 * an unload that should have happened earlier on the route.
 */
export function computeLineFurtherGoods(args: {
	readonly game: Game
	readonly line: FreightLineDefinition
	readonly currentStopIndex: number
	readonly orderedStopIndices?: readonly number[]
}): FreightLineFurtherGoodsSnapshot {
	let furtherNeededGoods: Partial<Record<GoodType, number>> = {}
	let furtherProvidedGoods: Partial<Record<GoodType, number>> = {}
	let furtherTransferredGoods: Partial<Record<GoodType, number>> = {}
	const order =
		args.orderedStopIndices ?? freightLineStopOrder(args.line, args.currentStopIndex).slice(1)
	for (const stopIndex of order) {
		const neededHere = measureFreightStopNeededGoods(args.game, args.line, stopIndex).perGood
		for (const [goodType, quantity] of Object.entries(neededHere) as [GoodType, number][]) {
			const matchedProvided = Math.min(quantity, furtherProvidedGoods[goodType] ?? 0)
			if (matchedProvided > 0) {
				furtherProvidedGoods = subtractGoodsCounts(furtherProvidedGoods, {
					[goodType]: matchedProvided,
				})
				furtherTransferredGoods = addGoodsCounts(furtherTransferredGoods, {
					[goodType]: matchedProvided,
				})
			}
			const remainingNeed = quantity - matchedProvided
			if (remainingNeed > 0) {
				furtherNeededGoods = addGoodsCounts(furtherNeededGoods, {
					[goodType]: remainingNeed,
				})
			}
		}
		furtherProvidedGoods = addGoodsCounts(
			furtherProvidedGoods,
			measureFreightStopProvidedGoods(args.game, args.line, stopIndex).perGood
		)
	}
	return {
		furtherNeededGoods: snapshotFromGoodsCounts(furtherNeededGoods),
		furtherProvidedGoods: snapshotFromGoodsCounts(furtherProvidedGoods),
		furtherTransferredGoods: snapshotFromGoodsCounts(furtherTransferredGoods),
	}
}

export function computeFutureFreightTransfer(args: {
	readonly game: Game
	readonly line: FreightLineDefinition
	readonly currentStopIndex: number
}): FreightFutureTransferSnapshot {
	const further = computeLineFurtherGoods(args)
	return {
		routeNeedGoods: further.furtherNeededGoods,
		routeSupplyGoods: further.furtherProvidedGoods,
		routeTransferredGoods: further.furtherTransferredGoods,
	}
}

/** Compares current cargo with downstream need to separate retained cargo, extra loading need, and surplus. */
export function projectLoadedGoodsAgainstFurtherNeeds(
	loadedGoods: Partial<Record<GoodType, number>>,
	furtherNeededGoods: Partial<Record<GoodType, number>>
): FreightProjectedLoadedGoodsSnapshot {
	const reservedLoadedGoods = intersectGoodsCounts(loadedGoods, furtherNeededGoods)
	return {
		reservedLoadedGoods: snapshotFromGoodsCounts(reservedLoadedGoods),
		remainingNeededGoods: snapshotFromGoodsCounts(
			subtractGoodsCounts(furtherNeededGoods, reservedLoadedGoods)
		),
		surplusLoadedGoods: snapshotFromGoodsCounts(
			subtractGoodsCounts(loadedGoods, reservedLoadedGoods)
		),
	}
}

function vehicleAvailableGoods(
	vehicle: VehicleEntity | undefined,
	goods: Partial<Record<GoodType, number>>
): Partial<Record<GoodType, number>> {
	if (!vehicle) return {}
	const out: Partial<Record<GoodType, number>> = {}
	for (const [goodType, quantity] of Object.entries(goods) as [GoodType, number][]) {
		const available = vehicle.storage.available(goodType)
		const transfer = Math.min(quantity, available)
		if (transfer > 0) out[goodType] = transfer
	}
	return out
}

function vehicleRoomGoods(
	vehicle: VehicleEntity | undefined,
	goods: Partial<Record<GoodType, number>>
): Partial<Record<GoodType, number>> {
	if (!vehicle) return {}
	const out: Partial<Record<GoodType, number>> = {}
	for (const [goodType, quantity] of Object.entries(goods) as [GoodType, number][]) {
		const room = vehicle.storage.hasRoom(goodType) ?? 0
		const transfer = Math.min(quantity, room)
		if (transfer > 0) out[goodType] = transfer
	}
	return out
}

function affordableImportGoods(args: {
	readonly game: Game
	readonly line: FreightLineDefinition
	readonly stop: FreightStop
	readonly goods: Partial<Record<GoodType, number>>
	readonly creditedVp?: number
}): Partial<Record<GoodType, number>> {
	if (!('trade' in args.stop)) return args.goods
	const profile = args.game.getSettlementTradeProfile(args.stop.trade.settlementId)
	if (!profile) return {}
	const prices = new Map<GoodType, number>()
	for (const offer of profile.offers) {
		if (offer.direction === 'sell') prices.set(offer.good, offer.priceVp)
	}
	const reserve = freightStopReserve(args.line, args.stop)
	const out: Partial<Record<GoodType, number>> = {}
	for (const [goodType, quantity] of Object.entries(args.goods) as [GoodType, number][]) {
		const unitPrice = prices.get(goodType)
		if (unitPrice === undefined || unitPrice <= 0) continue
		const balanceAfterExports =
			args.game.playerAccount.balanceVp + Math.max(0, args.creditedVp ?? 0)
		const affordable = Math.floor((balanceAfterExports - reserve) / unitPrice)
		const transfer = Math.min(quantity, Math.max(0, affordable))
		if (transfer > 0) out[goodType] = transfer
	}
	return out
}

function settlementCreditForGoods(
	game: Game,
	stop: FreightStop,
	goods: Partial<Record<GoodType, number>>
): number {
	if (!('trade' in stop)) return 0
	const profile = game.getSettlementTradeProfile(stop.trade.settlementId)
	const prices = new Map<GoodType, number>()
	for (const offer of profile?.offers ?? []) {
		if (offer.direction === 'buy') prices.set(offer.good, offer.priceVp)
	}
	let total = 0
	for (const [goodType, quantity] of Object.entries(goods) as [GoodType, number][]) {
		total += quantity * (prices.get(goodType) ?? 0)
	}
	return total
}

function tradeOfferCounts(game: Game, stop: FreightStop): { buy: number; sell: number } {
	if (!('trade' in stop)) return { buy: 0, sell: 0 }
	const profile = game.getSettlementTradeProfile(stop.trade.settlementId)
	let buy = 0
	let sell = 0
	for (const offer of profile?.offers ?? []) {
		if (offer.direction === 'buy') buy++
		else sell++
	}
	return { buy, sell }
}

export function explainFreightStopCommerce(args: {
	readonly game: Game
	readonly line: FreightLineDefinition
	readonly stopIndex: number
	readonly vehicle?: VehicleEntity
}): FreightStopCommerceExplanation {
	const stop = args.line.stops[args.stopIndex]
	if (!stop) {
		return {
			stopKind: 'radius-zone',
			servicePosition: {
				kind: 'unreachable',
				label: 'service target unavailable',
			},
			localProvidedGoods: snapshotFromGoodsCounts({}),
			localNeededGoods: snapshotFromGoodsCounts({}),
			downstreamDemandGoods: snapshotFromGoodsCounts({}),
			importOpportunityGoods: snapshotFromGoodsCounts({}),
			exportOpportunityGoods: snapshotFromGoodsCounts({}),
			retainedCargoGoods: snapshotFromGoodsCounts({}),
			surplusCargoGoods: snapshotFromGoodsCounts({}),
			blockReasons: ['no_downstream_demand'],
		}
	}
	const servicePosition = explainFreightStopServicePosition(args.game, stop)
	const localProvidedGoods = measureFreightStopProvidedGoods(args.game, args.line, args.stopIndex)
	const localNeededGoods = measureFreightStopNeededGoods(args.game, args.line, args.stopIndex)
	const further = computeLineFurtherGoods({
		game: args.game,
		line: args.line,
		currentStopIndex: args.stopIndex,
	})
	const loadedGoods = args.vehicle?.storage.stock ?? {}
	const projected = projectLoadedGoodsAgainstFurtherNeeds(
		loadedGoods,
		further.furtherNeededGoods.perGood
	)
	const exportOpportunityGoods = snapshotFromGoodsCounts(
		vehicleAvailableGoods(args.vehicle, finiteGoodsCounts(localNeededGoods.perGood))
	)
	const projectedExportCreditVp = settlementCreditForGoods(
		args.game,
		stop,
		exportOpportunityGoods.perGood
	)
	const neededProvidedIntersection = intersectGoodsCounts(
		projected.remainingNeededGoods.perGood,
		finiteGoodsCounts(localProvidedGoods.perGood)
	)
	const roomCappedImports = vehicleRoomGoods(args.vehicle, neededProvidedIntersection)
	const roomCappedImportTotal = sumRecord(roomCappedImports)
	const importOpportunityGoods = snapshotFromGoodsCounts(
		affordableImportGoods({
			game: args.game,
			line: args.line,
			stop,
			goods: roomCappedImports,
			creditedVp: projectedExportCreditVp,
		})
	)
	const blockReasons: FreightStopCommerceBlockReason[] = []
	const stopKind = freightStopKind(stop)
	if (!args.vehicle) addBlockReason(blockReasons, 'no_vehicle')
	if (further.furtherNeededGoods.total <= 0) {
		addBlockReason(blockReasons, 'no_downstream_demand')
		if (stopKind === 'settlement-trade' || stopKind === 'bay') {
			addBlockReason(blockReasons, 'buffer_full')
		}
	}
	if (args.vehicle && projected.remainingNeededGoods.total > 0 && roomCappedImportTotal <= 0) {
		addBlockReason(blockReasons, 'vehicle_full')
	}
	if ('trade' in stop) {
		const offerCounts = tradeOfferCounts(args.game, stop)
		if (offerCounts.sell <= 0 && projected.remainingNeededGoods.total > 0) {
			addBlockReason(blockReasons, 'no_matching_settlement_offer')
		}
		if (offerCounts.buy <= 0 && args.vehicle && sumRecord(args.vehicle.storage.stock) > 0) {
			addBlockReason(blockReasons, 'no_matching_settlement_offer')
		}
		if (offerCounts.sell > 0 && localProvidedGoods.total <= 0) {
			addBlockReason(blockReasons, 'policy_blocks_good')
		}
		if (offerCounts.buy > 0 && localNeededGoods.total <= 0) {
			addBlockReason(blockReasons, 'policy_blocks_good')
		}
		if (args.vehicle && roomCappedImportTotal > 0 && importOpportunityGoods.total <= 0) {
			addBlockReason(blockReasons, 'reserve_blocks_import')
		}
	}
	const explanation = {
		stopKind,
		servicePosition,
		localProvidedGoods,
		localNeededGoods,
		downstreamDemandGoods: further.furtherNeededGoods,
		importOpportunityGoods,
		exportOpportunityGoods,
		retainedCargoGoods: projected.reservedLoadedGoods,
		surplusCargoGoods: projected.surplusLoadedGoods,
		...('trade' in stop ? { minBalanceAfterBuyVp: freightStopReserve(args.line, stop) } : {}),
		blockReasons,
	}
	traces.vehicle.log?.('freightStop.servicePosition', {
		line: args.line,
		stop,
		stopIndex: args.stopIndex,
		servicePosition,
	})
	return explanation
}

/** Aggregate line route status for inspector summary display. */
export type FreightLineRouteStatus = 'active' | 'idle' | 'complete'

/** Per-vehicle status within a freight line route summary. */
export interface FreightLineVehicleStatus {
	readonly vehicleUid: string
	readonly vehicleType: string
	readonly vehicleTitle: string
	readonly currentStopId?: string
	readonly currentStopIndex?: number
	readonly isDocked: boolean
	readonly cargoSummary: string
	readonly actionable: boolean
}

/** Per-stop actionable summary for the route aggregate. */
export interface FreightLineStopSummary {
	readonly stopIndex: number
	readonly stopId: string
	readonly hasImportOpportunity: boolean
	readonly hasExportOpportunity: boolean
	readonly hasSurplusToUnload: boolean
	readonly hasDemandToSatisfy: boolean
	readonly blockReasons: readonly FreightStopCommerceBlockReason[]
}

/** Aggregate route summary for the line inspector header. */
export interface FreightLineRouteSummary {
	readonly status: FreightLineRouteStatus
	readonly statusExplanation: string
	readonly vehicles: readonly FreightLineVehicleStatus[]
	readonly stops: readonly FreightLineStopSummary[]
	readonly aggregateDownstreamDemand: FreightStopGoodsSnapshot
	readonly aggregateRetainedCargo: FreightStopGoodsSnapshot
	readonly aggregateSurplusCargo: FreightStopGoodsSnapshot
	readonly totalActionableStops: number
}

function vehicleCargoSummary(vehicle: VehicleEntity): string {
	const stock = vehicle.storage?.stock ?? {}
	const entries = Object.entries(stock)
		.filter(([, qty]) => (qty ?? 0) > 0)
		.map(([good, qty]) => `${good}:${qty}`)
	return entries.length > 0 ? entries.join(', ') : 'empty'
}

/**
 * Builds a route-level aggregate summary for a freight line with its assigned vehicles.
 *
 * Computed on-demand from live vehicle state; does not cache.
 */
export function summarizeFreightLineRoute(args: {
	readonly game: Game
	readonly line: FreightLineDefinition
	readonly vehicles: readonly VehicleEntity[]
}): FreightLineRouteSummary {
	const { game, line, vehicles } = args
	const stops: FreightLineStopSummary[] = []
	let aggregateDemand: Partial<Record<GoodType, number>> = {}
	let aggregateRetained: Partial<Record<GoodType, number>> = {}
	let aggregateSurplus: Partial<Record<GoodType, number>> = {}

	for (let i = 0; i < line.stops.length; i++) {
		// Compute per-stop commerce for the first assigned vehicle (best-effort)
		const primaryVehicle = vehicles.length > 0 ? vehicles[0] : undefined
		const explanation = explainFreightStopCommerce({
			game,
			line,
			stopIndex: i,
			vehicle: primaryVehicle,
		})
		stops.push({
			stopIndex: i,
			stopId: line.stops[i]?.id ?? `stop-${i}`,
			hasImportOpportunity: explanation.importOpportunityGoods.total > 0,
			hasExportOpportunity: explanation.exportOpportunityGoods.total > 0,
			hasSurplusToUnload: explanation.surplusCargoGoods.total > 0,
			hasDemandToSatisfy: explanation.downstreamDemandGoods.total > 0,
			blockReasons: explanation.blockReasons,
		})
		aggregateDemand = addGoodsCounts(
			aggregateDemand,
			explanation.downstreamDemandGoods.perGood
		)
		aggregateRetained = addGoodsCounts(
			aggregateRetained,
			explanation.retainedCargoGoods.perGood
		)
		aggregateSurplus = addGoodsCounts(
			aggregateSurplus,
			explanation.surplusCargoGoods.perGood
		)
	}

	const vehicleStatuses: FreightLineVehicleStatus[] = vehicles.map((vehicle) => {
		const svc = vehicle.service
		const lineSvc = isVehicleLineService(svc) ? svc : undefined
		const currentStopId = lineSvc?.stop?.id
		const currentStopIndex = currentStopId
			? line.stops.findIndex((s) => s.id === currentStopId)
			: undefined
		const docked = vehicle.isDocked
		const actionable =
			docked && lineSvc
				? stops.some(
						(s) =>
							s.stopIndex === currentStopIndex &&
							(s.hasImportOpportunity ||
								s.hasExportOpportunity ||
								s.hasSurplusToUnload)
					)
				: false
		return {
			vehicleUid: vehicle.uid,
			vehicleType: vehicle.vehicleType,
			vehicleTitle: vehicle.title,
			currentStopId,
			currentStopIndex: currentStopIndex !== undefined && currentStopIndex >= 0
				? currentStopIndex
				: undefined,
			isDocked: docked,
			cargoSummary: vehicleCargoSummary(vehicle),
			actionable,
		}
	})

	const totalActionableStops = stops.filter(
		(s) =>
			s.hasImportOpportunity ||
			s.hasExportOpportunity ||
			s.hasSurplusToUnload ||
			s.hasDemandToSatisfy
	).length

	let status: FreightLineRouteStatus = 'idle'
	if (totalActionableStops > 0 && vehicleStatuses.some((v) => v.actionable)) {
		status = 'active'
	} else if (totalActionableStops === 0 && line.cyclic) {
		status = 'complete'
	}

	// Build human-readable status explanation
	const statusExplanation = buildStatusExplanation(
		status,
		stops,
		vehicleStatuses,
		vehicles.length,
		line.cyclic
	)

	return {
		status,
		statusExplanation,
		vehicles: vehicleStatuses,
		stops,
		aggregateDownstreamDemand: snapshotFromGoodsCounts(aggregateDemand),
		aggregateRetainedCargo: snapshotFromGoodsCounts(aggregateRetained),
		aggregateSurplusCargo: snapshotFromGoodsCounts(aggregateSurplus),
		totalActionableStops,
	}
}

function buildStatusExplanation(
	status: FreightLineRouteStatus,
	stops: readonly FreightLineStopSummary[],
	vehicleStatuses: readonly FreightLineVehicleStatus[],
	assignedCount: number,
	isCyclic: boolean | undefined
): string {
	if (assignedCount === 0) {
		return 'No vehicles assigned to this line.'
	}
	if (status === 'active') {
		const actionableStopCount = stops.filter(
			(s) => s.hasImportOpportunity || s.hasExportOpportunity || s.hasSurplusToUnload
		).length
		const dockedVehicles = vehicleStatuses.filter((v) => v.actionable)
		if (dockedVehicles.length > 0) {
			const names = dockedVehicles.map((v) => v.vehicleTitle).join(', ')
			return `Active — ${names} docked with actionable transfers at ${actionableStopCount} stop(s).`
		}
		return `Active — ${actionableStopCount} stop(s) have actionable transfers.`
	}
	if (status === 'complete') {
		return 'All cyclic stops satisfied — no remaining import or export opportunity.'
	}
	// 'idle' — pick most informative reason
	const atStop = vehicleStatuses.filter(
		(v) => v.currentStopIndex !== undefined
	)
	if (atStop.length === 0) {
		return `Idle — ${assignedCount} vehicle(s) assigned but none currently at a stop.`
	}
	// Check if any vehicle is at a stop but not docked
	const atStopNotDocked = atStop.filter((v) => !v.isDocked)
	if (atStopNotDocked.length > 0) {
		const name = atStopNotDocked[0]!.vehicleTitle
		const idx = atStopNotDocked[0]!.currentStopIndex
		return `Idle — ${name} is at stop ${idx !== undefined ? idx + 1 : '?'} but not yet docked.`
	}
	// Check if any vehicle is docked at a stop with no opportunity
	const dockedNoOpportunity = atStop.filter(
		(v) => v.isDocked && !v.actionable
	)
	if (dockedNoOpportunity.length > 0) {
		const name = dockedNoOpportunity[0]!.vehicleTitle
		const idx = dockedNoOpportunity[0]!.currentStopIndex
		const stopBlockReasons =
			idx !== undefined && stops[idx]
				? stops[idx]!.blockReasons
				: []
		const reasonText =
			stopBlockReasons.length > 0
				? stopBlockReasons.map((r) => r.replace(/_/g, ' ')).join(', ')
				: 'no current opportunity'
		return `Idle — ${name} docked at stop ${idx !== undefined ? idx + 1 : '?'} but ${reasonText}.`
	}
	// Generic idle with unclear reason
	const totalBlockReasons = Array.from(
		new Set(stops.flatMap((s) => s.blockReasons))
	)
	if (totalBlockReasons.length > 0) {
		return `Idle — ${totalBlockReasons.map((r) => r.replace(/_/g, ' ')).join(', ')}.`
	}
	if (isCyclic) {
		return 'Idle — no actionable transfers at any stop.'
	}
	return 'Idle — no downstream demand at any stop.'
}
