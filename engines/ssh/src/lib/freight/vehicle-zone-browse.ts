import { jobBalance } from 'engine-rules'
import { Alveolus } from 'ssh/board/content/alveolus'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { Tile } from 'ssh/board/tile'
import { profile } from 'ssh/dev/debug'
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

export interface VehicleZoneBrowseSelection {
	readonly action: 'load' | 'provide'
	readonly goodType: GoodType
	readonly quantity?: number
	readonly targetTile: Tile
	readonly path: AxialCoord[]
	readonly adSource: FreightAdSource
	readonly priorityTier: FreightPriorityTier
	readonly score: number
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
	if (targetTile.content instanceof UnBuiltLand && targetTile.content.project) return 'project'
	if (targetTile.content instanceof Alveolus || targetTile.zone === 'residential') return 'hive'
	return 'vehicle-station'
}

export function zoneBrowseLoadPriorityTier(adSource: FreightAdSource): FreightPriorityTier {
	return adSource === 'vehicle-station' ? 'pureLine' : 'lineAndOffloadJoint'
}

function pathToTile(
	game: Game,
	_character: Character,
	startPos: Positioned,
	targetTile: Tile
): AxialCoord[] | undefined {
	const targetCoord = toAxialCoord(targetTile.position)
	const startCoord = toAxialCoord(startPos)
	if (!targetCoord || !startCoord) return undefined
	const roundedStart = axial.round(startCoord)
	if (axial.key(targetCoord) === axial.key(roundedStart)) return []
	return game.hex.findPathForVehicleServiceBorder(roundedStart, targetTile.position, maxWalkTime)
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

function pickZoneLoadSelection(
	game: Game,
	character: Character,
	vehicle: Vehicle,
	line: FreightLineDefinition,
	zoneStop: FreightStop & { zone: FreightZoneDefinition },
	startPos: Positioned,
	utility: ZoneBrowseUtilityContext
): VehicleZoneBrowseSelection | undefined {
	const neededGoods = new Set(Object.keys(utility.remainingNeededGoods) as GoodType[])
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
	if (selectableGoods.size === 0) return undefined
	let best: (VehicleZoneBrowseSelection & { score: number }) | undefined
	for (const tile of freightZoneTiles(game, zoneStop.zone)) {
		const tileAdSource = inferZoneLoadAdSource(tile)
		const candidates: GoodType[] = []
		for (const loose of tile.availableGoods) {
			if (!loose.available || loose.isRemoved) continue
			const goodType = loose.goodType as GoodType
			if (!selectableGoods.has(goodType)) continue
			if ((utility.remainingNeededGoods[goodType] ?? 0) <= 0 && !neededGoods.has(goodType)) continue
			if (vehicle.storage.hasRoom(goodType) <= 0) continue
			candidates.push(goodType)
		}
		if (candidates.length === 0) continue
		const path = pathToTile(game, character, startPos, tile)
		if (!path) continue
		for (const goodType of candidates) {
			const tileAvailable = tile.availableGoods.filter(
				(g) => g.goodType === goodType && g.available && !g.isRemoved
			).length
			const downstreamNeed = utility.remainingNeededGoods[goodType] ?? 0
			const vehicleRoom = vehicle.storage.hasRoom(goodType) ?? 0
			const quantity = Math.min(tileAvailable, downstreamNeed, vehicleRoom)
			if (quantity <= 0) continue
			const localNeed = (utility.localNeededGoods[goodType] ?? 0) > 0
			const adSource = localNeed ? CONSTRUCTION_DEMAND_AD_SOURCE : tileAdSource
			const priorityTier: FreightPriorityTier = localNeed
				? 'lineAndOffloadJoint'
				: zoneBrowseLoadPriorityTier(adSource)
			const score = scoreVehicleCandidate({
				kind: 'zoneLoad',
				urgency: jobBalance.loadOntoVehicle,
				distance: path.length,
				adSource,
				priorityTier,
				quantity,
			}).score
			if (!best || score > best.score || (score === best.score && path.length < best.path.length)) {
				best = {
					action: 'load',
					goodType,
					quantity,
					targetTile: tile,
					path,
					adSource,
					priorityTier,
					score,
				}
			}
		}
	}
	return best
}

function pickZoneProvideSelection(
	game: Game,
	character: Character,
	vehicle: Vehicle,
	line: FreightLineDefinition,
	zoneStop: FreightStop & { zone: FreightZoneDefinition },
	startPos: Positioned,
	utility: ZoneBrowseUtilityContext
): VehicleZoneBrowseSelection | undefined {
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
	let best: (VehicleZoneBrowseSelection & { score: number }) | undefined
	for (const tile of freightZoneTiles(game, zoneStop.zone)) {
		const content = freightConstructionDemandTarget(tile.content)
		if (!content || content.destroyed || content.isReady) continue
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
			const path = pathToTile(game, character, startPos, tile)
			if (!path) continue
			const score = scoreVehicleCandidate({
				kind: 'zoneProvide',
				urgency: jobBalance.provideFromVehicle,
				distance: path.length,
				adSource: CONSTRUCTION_DEMAND_AD_SOURCE,
				priorityTier,
				quantity,
			}).score
			if (!best || score > best.score) {
				best = {
					action: 'provide',
					goodType,
					quantity,
					targetTile: tile,
					path,
					adSource: CONSTRUCTION_DEMAND_AD_SOURCE,
					priorityTier,
					score,
				}
			}
		}
	}
	return best
}

export function pickVehicleZoneBrowseSelection(
	game: Game,
	character: Character,
	vehicle: Vehicle,
	line: FreightLineDefinition,
	stop: FreightStop,
	startPos: Positioned = character.position
): VehicleZoneBrowseSelection | undefined {
	const end = profile.proposedJobs.begin?.('pickVehicleZoneBrowseSelection', () => ({
		characterUid: character.uid,
		lineId: line.id,
		stopId: stop.id,
	}))
	try {
		if (!('zone' in stop)) return undefined
		const zoneStop = stop as FreightStop & { zone: FreightZoneDefinition }
		const utility = zoneBrowseUtilityContext(game, vehicle, line, stop)
		if (!utility) return undefined
		const load = pickZoneLoadSelection(game, character, vehicle, line, zoneStop, startPos, utility)
		const provide = pickZoneProvideSelection(
			game,
			character,
			vehicle,
			line,
			zoneStop,
			startPos,
			utility
		)
		return !load ? provide : !provide ? load : provide.score >= load.score ? provide : load
	} finally {
		end?.()
	}
}
