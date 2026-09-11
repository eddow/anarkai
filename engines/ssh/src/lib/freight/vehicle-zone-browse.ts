import { jobBalance } from 'engine-rules'
import { Alveolus } from 'ssh/board/content/alveolus'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { Tile } from 'ssh/board/tile'
import { profile } from 'ssh/dev/debug'
import { debugObjectId } from 'ssh/dev/debug-object-id'
import {
	CONSTRUCTION_DEMAND_AD_SOURCE,
	freightConstructionDemandTarget,
} from 'ssh/freight/construction-demand'
import {
	distributeSegmentAllowsGoodTypeForSegment,
	type FreightLineDefinition,
	type FreightStop,
	type FreightZoneDefinition,
	findDistributeRouteSegments,
	findGatherRouteSegments,
	freightZoneTiles,
	gatherSegmentAllowsGoodTypeForSegment,
	gatherSelectableGoodTypes,
} from 'ssh/freight/freight-line'
import {
	computeLineFurtherGoods,
	measureFreightStopNeededGoods,
	projectLoadedGoodsAgainstFurtherNeeds,
} from 'ssh/freight/freight-stop-utility'
import {
	FREIGHT_LINE_ALL_GOOD_TYPES,
	type GoodSelectionPolicy,
	listGoodTypesMatchingSelectionPolicy,
} from 'ssh/freight/goods-selection-policy'
import type { FreightAdSource, FreightPriorityTier } from 'ssh/freight/priority-channel'
import {
	scoreVehicleCandidate,
	vehicleCandidateTierWeight,
} from 'ssh/freight/vehicle-candidate-policy'
import type { Game } from 'ssh/game/game'
import type { Character } from 'ssh/population/character'
import type { Vehicle } from 'ssh/population/vehicle/entity'
import type { GoodType } from 'ssh/types/base'
import { type AxialCoord, axial } from 'ssh/utils'
import { type Positioned, toAxialCoord } from 'ssh/utils/position'
import { maxWalkTime } from '../../../assets/constants'

/**
 * Cheap, plan-agnostic zone-browse answer: *what* is worth doing in this zone, not *how* to get
 * there. Produced by {@link findVehicleZoneBrowseSelection} without any pathfinding so decision-only
 * callers (begin-service, stop advance, joint-line verification) always read live state.
 */
export interface VehicleZoneBrowseMatch {
	readonly action: 'load' | 'provide'
	readonly goodType: GoodType
	readonly quantity?: number
	readonly targetTile: Tile
	readonly adSource: FreightAdSource
	readonly priorityTier: FreightPriorityTier
	readonly score: number
}

/** A {@link VehicleZoneBrowseMatch} with the concrete approach path resolved for grab execution. */
export interface VehicleZoneBrowseSelection extends VehicleZoneBrowseMatch {
	readonly path: AxialCoord[]
}

interface ZoneBrowseUtilityContext {
	readonly stopIndex: number
	readonly remainingNeededGoods: Partial<Record<GoodType, number>>
	readonly surplusLoadedGoods: Partial<Record<GoodType, number>>
	readonly localNeededGoods: Partial<Record<GoodType, number>>
}

export function zoneBrowseTierWeight(priorityTier: FreightPriorityTier): number {
	return vehicleCandidateTierWeight(priorityTier)
}

export function zoneBrowseUrgency(
	action: VehicleZoneBrowseSelection['action'],
	priorityTier: FreightPriorityTier
): number {
	const base = action === 'load' ? jobBalance.loadOntoVehicle : jobBalance.provideFromVehicle
	return base * zoneBrowseTierWeight(priorityTier)
}

export function inferZoneLoadAdSource(targetTile: Tile): FreightAdSource {
	if (targetTile.content instanceof UnBuiltLand && targetTile.content.site) return 'project'
	if (targetTile.content instanceof Alveolus || targetTile.zone?.type === 'residential')
		return 'hive'
	return 'vehicle-station'
}

export function zoneBrowseLoadPriorityTier(adSource: FreightAdSource): FreightPriorityTier {
	return adSource === 'vehicle-station' ? 'pureLine' : 'lineAndOffloadJoint'
}

function pathToTile(game: Game, startPos: Positioned, targetTile: Tile): AxialCoord[] | undefined {
	const targetCoord = toAxialCoord(targetTile.position)
	const startCoord = toAxialCoord(startPos)
	if (!targetCoord || !startCoord) return undefined
	const roundedStart = axial.round(startCoord)
	if (axial.key(targetCoord) === axial.key(roundedStart)) return []
	return game.hex.findPathForVehicleServiceBorder(roundedStart, targetTile.position, maxWalkTime)
}

/**
 * Cheap distance proxy used for decision scoring when no path is computed. The old code scored by
 * A* path length; decision-only callers no longer run A*, so an axial distance is close enough to
 * rank nearby tiles while keeping the zone scan allocation-free.
 */
function tileDistance(startPos: Positioned, tile: Tile): number {
	const start = toAxialCoord(startPos)
	const target = toAxialCoord(tile.position)
	if (!start || !target) return Number.POSITIVE_INFINITY
	return axial.distance(axial.round(start), axial.round(target))
}

export function zoneBrowseUtilityContext(
	game: Game,
	vehicle: Vehicle,
	line: FreightLineDefinition,
	stop: FreightStop
): ZoneBrowseUtilityContext | undefined {
	const stopIndex = line.stops.indexOf(stop)
	if (stopIndex < 0) return undefined
	const further = computeLineFurtherGoods({
		game,
		line,
		currentStopIndex: stopIndex,
	})
	const projected = projectLoadedGoodsAgainstFurtherNeeds(
		vehicle.storage.stock,
		further.furtherNeededGoods.perGood
	)
	const localNeededGoods = measureFreightStopNeededGoods(game, line, stopIndex).perGood
	return {
		stopIndex,
		remainingNeededGoods: projected.remainingNeededGoods.perGood,
		surplusLoadedGoods: projected.surplusLoadedGoods.perGood,
		localNeededGoods,
	}
}

function allowedByPolicy(policy: GoodSelectionPolicy | undefined, goodType: GoodType): boolean {
	if (!policy) return true
	return listGoodTypesMatchingSelectionPolicy(policy, FREIGHT_LINE_ALL_GOOD_TYPES).includes(
		goodType
	)
}

function explicitZoneLoadGoods(
	zoneStop: FreightStop & { zone: FreightZoneDefinition },
	utility: ZoneBrowseUtilityContext
): Set<GoodType> {
	const goods = new Set<GoodType>()
	if (!zoneStop.loadSelection) return goods
	for (const goodType of [
		...Object.keys(utility.remainingNeededGoods),
		...Object.keys(utility.localNeededGoods),
	] as GoodType[]) {
		if (allowedByPolicy(zoneStop.loadSelection, goodType)) goods.add(goodType)
	}
	return goods
}

/**
 * Ranked load candidates, best first. `exist?` reads `[0]`; `path?` retries down the list so a
 * single unreachable winner does not hide a reachable runner-up.
 */
function collectZoneLoadMatches(
	game: Game,
	vehicle: Vehicle,
	line: FreightLineDefinition,
	zoneStop: FreightStop & { zone: FreightZoneDefinition },
	startPos: Positioned,
	utility: ZoneBrowseUtilityContext
): (VehicleZoneBrowseMatch & { distance: number })[] {
	const neededGoods = new Set(Object.keys(utility.remainingNeededGoods) as GoodType[])
	// Gather zones may have no loadSelection; still treat standalone construction /
	// local halt need as selectable so begin-service and zone-load can see loose goods.
	for (const goodType of Object.keys(utility.localNeededGoods) as GoodType[]) {
		neededGoods.add(goodType)
	}
	for (const goodType of explicitZoneLoadGoods(zoneStop, utility)) neededGoods.add(goodType)
	const stopIndex = utility.stopIndex
	for (const segment of findGatherRouteSegments(line)) {
		if (segment.loadStopIndex !== stopIndex) continue
		const unloadStop = line.stops[segment.unloadStopIndex]
		if (!unloadStop || !('anchor' in unloadStop)) continue
		const tile = game.hex.getTile({ q: unloadStop.anchor.coord[0], r: unloadStop.anchor.coord[1] })
		const content = tile?.content
		if (!(content instanceof Alveolus) || !content.hive) continue
		for (const goodType of Object.keys(content.hive.needs) as GoodType[]) {
			if (gatherSegmentAllowsGoodTypeForSegment(line, segment, goodType)) neededGoods.add(goodType)
		}
	}
	const selectableGoods = zoneStop.loadSelection
		? new Set(listGoodTypesMatchingSelectionPolicy(zoneStop.loadSelection, [...neededGoods]))
		: new Set(gatherSelectableGoodTypes(line, [...neededGoods]))
	if (selectableGoods.size === 0) return []
	const matches: (VehicleZoneBrowseMatch & { distance: number })[] = []
	for (const tile of freightZoneTiles(game, zoneStop.zone)) {
		const tileAdSource = inferZoneLoadAdSource(tile)
		const candidates: GoodType[] = []
		for (const loose of tile.availableGoods) {
			if (loose.claimedBy !== undefined || loose.isRemoved) continue
			const goodType = loose.goodType as GoodType
			if (!selectableGoods.has(goodType)) continue
			if ((utility.remainingNeededGoods[goodType] ?? 0) <= 0 && !neededGoods.has(goodType)) continue
			if (vehicle.storage.hasRoom(goodType) <= 0) continue
			candidates.push(goodType)
		}
		if (candidates.length === 0) continue
		const distance = tileDistance(startPos, tile)
		for (const goodType of candidates) {
			const tileAvailable = tile.availableGoods.filter(
				(g) => g.goodType === goodType && g.claimedBy === undefined && !g.isRemoved
			).length
			// Single-stop / last-stop local exchange has no further-stop need projection, but the
			// current halt can still sink goods (construction / hive room). Count both.
			// Gather load also seeds neededGoods from hive.needs keys; when the unload hive has
			// room that did not project into remainingNeededGoods (e.g. empty allowed set at the
			// zone stop historically), still allow at least one unit so begin-service can start.
			const downstreamNeed = utility.remainingNeededGoods[goodType] ?? 0
			const localNeedQty = utility.localNeededGoods[goodType] ?? 0
			const need = Math.max(downstreamNeed, localNeedQty, neededGoods.has(goodType) ? 1 : 0)
			const vehicleRoom = vehicle.storage.hasRoom(goodType) ?? 0
			const quantity = Math.min(tileAvailable, need, vehicleRoom)
			if (quantity <= 0) continue
			const localNeed = localNeedQty > 0
			const adSource = localNeed ? CONSTRUCTION_DEMAND_AD_SOURCE : tileAdSource
			const priorityTier: FreightPriorityTier = localNeed
				? 'lineAndOffloadJoint'
				: zoneBrowseLoadPriorityTier(adSource)
			const score = scoreVehicleCandidate({
				kind: 'zoneLoad',
				urgency: jobBalance.loadOntoVehicle,
				distance,
				adSource,
				priorityTier,
				quantity,
			}).score
			matches.push({
				action: 'load',
				goodType,
				quantity,
				targetTile: tile,
				adSource,
				priorityTier,
				score,
				distance,
			})
		}
	}
	matches.sort((a, b) => b.score - a.score || a.distance - b.distance)
	return matches
}

function pickZoneProvideSelection(
	game: Game,
	vehicle: Vehicle,
	line: FreightLineDefinition,
	zoneStop: FreightStop & { zone: FreightZoneDefinition },
	startPos: Positioned,
	utility: ZoneBrowseUtilityContext
): VehicleZoneBrowseMatch | undefined {
	const hasExplicitUnload = !!zoneStop.unloadSelection
	if (
		!hasExplicitUnload &&
		findGatherRouteSegments(line).some((segment) => segment.loadStopIndex === utility.stopIndex)
	) {
		return undefined
	}
	const segments = findDistributeRouteSegments(line).filter(
		(segment) => segment.unloadStopIndex === utility.stopIndex
	)
	const isDistributeStop = segments.length > 0
	const hasSurplus = Object.values(utility.surplusLoadedGoods).some((q) => q > 0)
	// Allow surplus offload at any zone stop (not just distribute-unload), so vehicles
	// can drop stranded cargo when downstream need disappears (e.g. construction sites
	// that were satisfied mid-route).
	const canProvide = hasExplicitUnload || isDistributeStop || hasSurplus
	if (!canProvide) return undefined
	const priorityTier: FreightPriorityTier = 'pureOffload'
	let best: (VehicleZoneBrowseMatch & { distance: number }) | undefined
	for (const tile of freightZoneTiles(game, zoneStop.zone)) {
		const content = freightConstructionDemandTarget(tile.content)
		if (!content || content.destroyed || content.isReady) continue
		const distance = tileDistance(startPos, tile)
		for (const goodType of Object.keys(content.remainingNeeds) as GoodType[]) {
			const need = content.effectiveRemainingNeeds[goodType] ?? 0
			if (need <= 0) continue
			if (hasExplicitUnload) {
				if (!allowedByPolicy(zoneStop.unloadSelection, goodType)) continue
			} else if (isDistributeStop) {
				if (
					!segments.some((segment) =>
						distributeSegmentAllowsGoodTypeForSegment(line, segment, goodType)
					)
				) {
					continue
				}
			}
			// For surplus offload (non-distribute, non-explicit), gate by surplusLoadedGoods
			const isSurplusOnly = !hasExplicitUnload && !isDistributeStop
			const surplusGate = isSurplusOnly ? (utility.surplusLoadedGoods[goodType] ?? 0) : Infinity
			const rawAvail = vehicle.storage.available(goodType)
			const available = isSurplusOnly
				? Math.min(rawAvail, surplusGate)
				: Math.min(rawAvail, utility.surplusLoadedGoods[goodType] ?? rawAvail)
			if (available <= 0) continue
			const room = content.storage.hasRoom(goodType) ?? 0
			if (room <= 0) continue
			const quantity = Math.min(need, available, room)
			if (quantity <= 0) continue
			const score = scoreVehicleCandidate({
				kind: 'zoneProvide',
				urgency: jobBalance.provideFromVehicle,
				distance,
				adSource: CONSTRUCTION_DEMAND_AD_SOURCE,
				priorityTier,
				quantity,
			}).score
			if (!best || score > best.score || (score === best.score && distance < best.distance)) {
				best = {
					action: 'provide',
					goodType,
					quantity,
					targetTile: tile,
					adSource: CONSTRUCTION_DEMAND_AD_SOURCE,
					priorityTier,
					score,
					distance,
				}
			}
		}
	}
	return best
}

/**
 * Two-phase zone query — **exist?** phase.
 *
 * Answers "is there something worth doing in this zone?" from live state only: it scans
 * {@link freightZoneTiles} + `tile.availableGoods` with the current policy/need/room gates, does no
 * pathfinding, keeps no cache, and reads no version counter. Decision-only callers (begin-service,
 * stop advance, joint-line verification, movement target) use this; the grab path re-resolves with
 * {@link pickVehicleZoneBrowseSelection} and validates reachability there.
 */
export function findVehicleZoneBrowseSelection(
	game: Game,
	character: Character,
	vehicle: Vehicle,
	line: FreightLineDefinition,
	stop: FreightStop,
	startPos: Positioned = character.position
): VehicleZoneBrowseMatch | undefined {
	const end = profile.proposedJobs.begin?.('findVehicleZoneBrowseSelection', () => ({
		characterUid: debugObjectId(character) ?? '',
		lineId: debugObjectId(line),
		stopIndex: line.stops.indexOf(stop),
	}))
	try {
		if (!('zone' in stop)) return undefined
		const zoneStop = stop as FreightStop & { zone: FreightZoneDefinition }

		const utility = zoneBrowseUtilityContext(game, vehicle, line, zoneStop)
		if (!utility) return undefined
		const loads = collectZoneLoadMatches(game, vehicle, line, zoneStop, startPos, utility)
		const load = loads[0]
		const provide = pickZoneProvideSelection(game, vehicle, line, zoneStop, startPos, utility)
		return !load ? provide : !provide ? load : provide.score >= load.score ? provide : load
	} finally {
		end?.()
	}
}

/**
 * Ranked zone matches, best first, for grab execution. Load candidates retry down the ranked list;
 * provide has a single best (construction sinks, no loose claim involved).
 */
function collectZoneBrowseMatches(
	game: Game,
	vehicle: Vehicle,
	line: FreightLineDefinition,
	zoneStop: FreightStop & { zone: FreightZoneDefinition },
	startPos: Positioned,
	utility: ZoneBrowseUtilityContext
): VehicleZoneBrowseMatch[] {
	const loads = collectZoneLoadMatches(game, vehicle, line, zoneStop, startPos, utility)
	const provide = pickZoneProvideSelection(game, vehicle, line, zoneStop, startPos, utility)
	if (!provide) return loads
	// Preserve exist?-phase winner ordering: sort by score so the first reachable match wins,
	// matching what `findVehicleZoneBrowseSelection` would have picked among reachable ones.
	return [...loads, provide].sort((a, b) => b.score - a.score)
}

/**
 * Two-phase zone query — **path?** phase.
 *
 * Walks the ranked matches and returns the first reachable one (single `pathToTile` per
 * candidate, best first). Returns `undefined` when nothing is reachable, letting the caller
 * degrade to soft idle + replan instead of minting goods.
 */
export function pickVehicleZoneBrowseSelection(
	game: Game,
	character: Character,
	vehicle: Vehicle,
	line: FreightLineDefinition,
	stop: FreightStop,
	startPos: Positioned = character.position
): VehicleZoneBrowseSelection | undefined {
	if (!('zone' in stop)) return undefined
	const zoneStop = stop as FreightStop & { zone: FreightZoneDefinition }
	const utility = zoneBrowseUtilityContext(game, vehicle, line, zoneStop)
	if (!utility) return undefined
	for (const match of collectZoneBrowseMatches(game, vehicle, line, zoneStop, startPos, utility)) {
		const path = pathToTile(game, startPos, match.targetTile)
		if (!path) continue
		return { ...match, path }
	}
	return undefined
}

/**
 * Reachability-aware zone check for stop-leave decisions: like `exist?` but validates that at
 * least one ranked match is actually reachable, so an unreachable-but-present good never reads as
 * "work remains" forever.
 */
export function zoneBrowseHasReachableMatch(
	game: Game,
	character: Character,
	vehicle: Vehicle,
	line: FreightLineDefinition,
	stop: FreightStop,
	startPos: Positioned = character.position
): boolean {
	return pickVehicleZoneBrowseSelection(game, character, vehicle, line, stop, startPos) !== undefined
}
