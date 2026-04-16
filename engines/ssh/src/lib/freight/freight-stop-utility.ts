import { freightLineHiveNeedPriorityWeight } from 'engine-rules'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import { type BuildSite, isStandaloneBuildSiteShell } from 'ssh/build-site'
import {
	distributeSegmentAllowsGoodTypeForSegment,
	type FreightDistributeRouteSegment,
	type FreightGatherRouteSegment,
	type FreightLineDefinition,
	type FreightStop,
	findDistributeRouteSegments,
	findGatherRouteSegments,
	gatherSegmentAllowsGoodTypeForSegment,
} from 'ssh/freight/freight-line'
import {
	FREIGHT_LINE_ALL_GOOD_TYPES,
	type GoodSelectionPolicy,
	listGoodTypesMatchingSelectionPolicy,
} from 'ssh/freight/goods-selection-policy'
import type { Game } from 'ssh/game/game'
import type { Hive } from 'ssh/hive/hive'
import type { GoodType } from 'ssh/types/base'
import type { ExchangePriority } from 'ssh/utils/advertisement'
import { type AxialCoord, axial } from 'ssh/utils/axial'
import { toAxialCoord } from 'ssh/utils/position'

/** Per-good quantities for a stop (loose goods, stored goods, or need sink). */
export interface FreightStopGoodsSnapshot {
	readonly perGood: Readonly<Partial<Record<GoodType, number>>>
	/** Sum of {@link perGood} values. */
	readonly total: number
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

function sumRecord(values: Partial<Record<GoodType, number>>): number {
	let s = 0
	for (const v of Object.values(values)) {
		if (typeof v === 'number' && v > 0) s += v
	}
	return s
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
	map: Partial<Record<GoodType, number>>
): FreightStopGoodsSnapshot {
	const perGood = normalizeGoodsCounts(map)
	return { perGood, total: sumRecord(perGood) }
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
	const gatherSegment = gatherLoadSegmentForStop(line, stopIndex)
	if (gatherSegment) return listGoodsAllowedOnGatherSegment(line, gatherSegment)
	const distributeSegment = distributeLoadSegmentForStop(line, stopIndex)
	if (distributeSegment) return listGoodsAllowedOnDistributeSegment(line, distributeSegment)
	return []
}

function allowedGoodsNeededAtStop(
	line: FreightLineDefinition,
	stopIndex: number,
	stop: FreightStop
): GoodType[] {
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
	const out: Tile[] = []
	for (const tile of game.hex.tiles) {
		const tc = toAxialCoord(tile.position)
		if (!tc) continue
		if (axial.distance(center, tc) <= radius) out.push(tile)
	}
	return out
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
	return snapshotFromGoodsCounts(perGood)
}

/**
 * Zone **sink**: standalone construction {@link BuildSite.remainingNeeds} on tiles in the radius.
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
		const c = tile.content
		if (!isStandaloneBuildSiteShell(c) || c.destroyed || c.isReady) continue
		const site = c as BuildSite
		for (const g of allowedGoods) {
			const need = site.remainingNeeds[g as string]
			if (need === undefined || need <= 0) continue
			perGood[g] = (perGood[g] ?? 0) + need
		}
	}
	return snapshotFromGoodsCounts(perGood)
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
	return snapshotFromGoodsCounts(perGood)
}

function sumHiveStorageHasRoomForGood(hive: Hive, goodType: GoodType): number {
	let sum = 0
	for (const alv of hive.generalStorages) {
		const room = alv.storage.hasRoom(goodType) ?? 0
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
		...snapshotFromGoodsCounts(perGood),
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
		...snapshotFromGoodsCounts(perGood),
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
	if ('zone' in stop && stop.zone.kind === 'radius') {
		return measureZoneLooseGoodsSource(
			game,
			{ q: stop.zone.center[0], r: stop.zone.center[1] },
			stop.zone.radius,
			allowedGoodsSet
		)
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
	if ('zone' in stop && stop.zone.kind === 'radius') {
		return measureZoneStandaloneConstructionNeedSink(
			game,
			{ q: stop.zone.center[0], r: stop.zone.center[1] },
			stop.zone.radius,
			allowedGoodsSet
		)
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
}): FreightLineFurtherGoodsSnapshot {
	let furtherNeededGoods: Partial<Record<GoodType, number>> = {}
	let furtherProvidedGoods: Partial<Record<GoodType, number>> = {}
	let furtherTransferredGoods: Partial<Record<GoodType, number>> = {}
	for (let stopIndex = args.currentStopIndex + 1; stopIndex < args.line.stops.length; stopIndex++) {
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
