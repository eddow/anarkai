import { jobBalance } from 'engine-rules'
import { Alveolus } from 'ssh/board/content/alveolus'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { Tile } from 'ssh/board/tile'
import { isStandaloneBuildSiteShell } from 'ssh/build-site'
import { CONSTRUCTION_DEMAND_AD_SOURCE } from 'ssh/freight/construction-demand'
import {
	distributeSegmentAllowsGoodTypeForSegment,
	type FreightLineDefinition,
	type FreightStop,
	type FreightZoneDefinitionRadius,
	findDistributeRouteSegments,
	gatherSelectableGoodTypes,
} from 'ssh/freight/freight-line'
import {
	computeLineFurtherGoods,
	projectLoadedGoodsAgainstFurtherNeeds,
} from 'ssh/freight/freight-stop-utility'
import { aggregateHiveNeedTypes } from 'ssh/freight/freight-zone-gather-target'
import type { FreightAdSource, FreightPriorityTier } from 'ssh/freight/priority-channel'
import type { Game } from 'ssh/game/game'
import type { Character } from 'ssh/population/character'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
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
}

interface ZoneBrowseUtilityContext {
	readonly stopIndex: number
	readonly remainingNeededGoods: Partial<Record<GoodType, number>>
	readonly surplusLoadedGoods: Partial<Record<GoodType, number>>
}

export function zoneBrowseTierWeight(priorityTier: FreightPriorityTier): number {
	return jobBalance.priorityTier[priorityTier]
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
	character: Character,
	startPos: Positioned,
	targetTile: Tile
): AxialCoord[] | undefined {
	const targetCoord = toAxialCoord(targetTile.position)
	const startCoord = toAxialCoord(startPos)
	if (!targetCoord || !startCoord) return undefined
	if (axial.key(targetCoord) === axial.key(startCoord)) return []
	return (
		game.hex.findPathForCharacter(startPos, targetTile.position, character, maxWalkTime, true) ??
		undefined
	)
}

export function zoneBrowseUtilityContext(
	game: Game,
	vehicle: VehicleEntity,
	line: FreightLineDefinition,
	stop: FreightStop
): ZoneBrowseUtilityContext | undefined {
	const stopIndex = line.stops.findIndex((candidate) => candidate.id === stop.id)
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
	return {
		stopIndex,
		remainingNeededGoods: projected.remainingNeededGoods.perGood,
		surplusLoadedGoods: projected.surplusLoadedGoods.perGood,
	}
}

function pickZoneLoadSelection(
	game: Game,
	character: Character,
	vehicle: VehicleEntity,
	line: FreightLineDefinition,
	zoneStop: FreightStop & { zone: FreightZoneDefinitionRadius },
	startPos: Positioned,
	utility: ZoneBrowseUtilityContext
): VehicleZoneBrowseSelection | undefined {
	const neededGoods = new Set([
		...(Object.keys(utility.remainingNeededGoods) as GoodType[]),
		...aggregateHiveNeedTypes(game),
	])
	const selectableGoods = new Set(gatherSelectableGoodTypes(line, [...neededGoods]))
	const center: AxialCoord = { q: zoneStop.zone.center[0], r: zoneStop.zone.center[1] }
	let best: (VehicleZoneBrowseSelection & { score: number }) | undefined
	for (const tile of game.hex.tiles) {
		const tileCoord = toAxialCoord(tile.position)
		if (!tileCoord || axial.distance(center, tileCoord) > zoneStop.zone.radius) continue
		const path = pathToTile(game, character, startPos, tile)
		if (!path) continue
		const adSource = inferZoneLoadAdSource(tile)
		const priorityTier = zoneBrowseLoadPriorityTier(adSource)
		const urgency = zoneBrowseUrgency('load', priorityTier)
		for (const loose of tile.availableGoods) {
			if (!loose.available || loose.isRemoved) continue
			const goodType = loose.goodType as GoodType
			if (!selectableGoods.has(goodType)) continue
			if ((utility.remainingNeededGoods[goodType] ?? 0) <= 0 && !neededGoods.has(goodType)) continue
			if (vehicle.storage.hasRoom(goodType) <= 0) continue
			const score = urgency / (path.length + 1)
			if (!best || score > best.score || (score === best.score && path.length < best.path.length)) {
				best = {
					action: 'load',
					goodType,
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
	vehicle: VehicleEntity,
	line: FreightLineDefinition,
	zoneStop: FreightStop & { zone: FreightZoneDefinitionRadius },
	startPos: Positioned,
	utility: ZoneBrowseUtilityContext
): VehicleZoneBrowseSelection | undefined {
	const segments = findDistributeRouteSegments(line).filter(
		(segment) => segment.unloadStopIndex === utility.stopIndex
	)
	if (segments.length === 0) return undefined
	const center: AxialCoord = { q: zoneStop.zone.center[0], r: zoneStop.zone.center[1] }
	const priorityTier: FreightPriorityTier = 'pureOffload'
	const urgency = zoneBrowseUrgency('provide', priorityTier)
	let best: (VehicleZoneBrowseSelection & { score: number }) | undefined
	for (const tile of game.hex.tiles) {
		const tileCoord = toAxialCoord(tile.position)
		if (!tileCoord || axial.distance(center, tileCoord) > zoneStop.zone.radius) continue
		const content = tile.content
		if (!isStandaloneBuildSiteShell(content) || content.destroyed || content.isReady) continue
		for (const goodType of Object.keys(content.remainingNeeds) as GoodType[]) {
			const need = content.remainingNeeds[goodType] ?? 0
			if (need <= 0) continue
			if (
				!segments.some((segment) =>
					distributeSegmentAllowsGoodTypeForSegment(line, segment, goodType)
				)
			)
				continue
			const available = Math.min(
				vehicle.storage.available(goodType),
				utility.surplusLoadedGoods[goodType] ?? 0
			)
			if (available <= 0) continue
			const room = content.storage.hasRoom(goodType) ?? 0
			if (room <= 0) continue
			const quantity = Math.min(need, available, room)
			if (quantity <= 0) continue
			const path = pathToTile(game, character, startPos, tile)
			if (!path) continue
			const score = (urgency * quantity) / (path.length + 1)
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
	vehicle: VehicleEntity,
	line: FreightLineDefinition,
	stop: FreightStop,
	startPos: Positioned = character.position
): VehicleZoneBrowseSelection | undefined {
	if (!('zone' in stop) || stop.zone.kind !== 'radius') return undefined
	const zoneStop = stop as FreightStop & { zone: FreightZoneDefinitionRadius }
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
	if (!load) return provide
	if (!provide) return load
	const loadScore = zoneBrowseUrgency('load', load.priorityTier) / (load.path.length + 1)
	const provideScore =
		(zoneBrowseUrgency('provide', provide.priorityTier) * (provide.quantity ?? 1)) /
		(provide.path.length + 1)
	return provideScore >= loadScore ? provide : load
}
