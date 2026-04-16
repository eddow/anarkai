import { jobBalance, offloadRange } from 'engine-rules'
import { Alveolus } from 'ssh/board/content/alveolus'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { LooseGood } from 'ssh/board/looseGoods'
import type { Tile } from 'ssh/board/tile'
import { isStandaloneBuildSiteShell } from 'ssh/build-site'
import { assert, traces } from 'ssh/debug'
import {
	findGatherRouteSegments,
	freightStopAnchorMatchesAlveolus,
	gatherSegmentAllowsGoodType,
	gatherSegmentAllowsGoodTypeForSegment,
	gatherSelectableGoodTypes,
} from 'ssh/freight/freight-line'
import { aggregateHiveNeedTypes } from 'ssh/freight/freight-zone-gather-target'
import {
	ensureVehicleServiceStarted,
	freightStopMovementTarget,
	pickInitialVehicleServiceCandidate,
	projectedLineStopForVehicleHop,
} from 'ssh/freight/vehicle-run'
import {
	pickVehicleZoneBrowseSelection,
	zoneBrowseUtilityContext,
} from 'ssh/freight/vehicle-zone-browse'
import type { Game } from 'ssh/game/game'
import type { Character } from 'ssh/population/character'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import { isVehicleLineService, isVehicleOffloadService } from 'ssh/population/vehicle/vehicle'
import type { Storage } from 'ssh/storage'
import type {
	GoodType,
	Job,
	UnloadFromVehicleProbe,
	VehicleHopJob,
	VehicleJob,
	VehicleOffloadJob,
	ZoneBrowseJob,
} from 'ssh/types/base'
import { type AxialCoord, axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import { maxWalkTime } from '../../../assets/constants'

const LINE_FREIGHT_VEHICLE = 'wheelbarrow' as const

/** True for jobs that use {@link VehicleEntity} line/offload service and `vehicleUid`. */
export function isVehicleFreightJob(job: Job): job is Job & VehicleJob {
	return 'vehicleUid' in job
}

/**
 * When a vehicle work job is selected, attach the correct {@link VehicleEntity.service} immediately
 * (line-freight vs maintenance offload) and bind {@link VehicleEntity.service.operator}.
 */
export function allocateVehicleServiceForJob(
	game: Game,
	character: Character,
	vehicle: VehicleEntity,
	job: Job
): void {
	switch (job.job) {
		case 'vehicleOffload': {
			if (isVehicleLineService(vehicle.service)) {
				throw new Error('vehicleOffload: line service already active')
			}
			if (isVehicleOffloadService(vehicle.service)) {
				vehicle.setServiceOperator(character)
			} else {
				vehicle.beginOffloadService(character)
			}
			return
		}
		case 'vehicleHop': {
			if (job.approachPath?.length) {
				assert(
					ensureVehicleServiceStarted(vehicle, character, game, character),
					'vehicleHop approach: could not start line service'
				)
				return
			}
			if (job.needsBeginService) {
				assert(
					ensureVehicleServiceStarted(vehicle, character, game, character, {
						lineId: job.lineId,
						stopId: job.stopId,
					}),
					'vehicleHop beginService: could not start line service'
				)
				return
			}
			assert(isVehicleLineService(vehicle.service), 'vehicleHop requires line service')
			vehicle.setServiceOperator(character)
			return
		}
		case 'zoneBrowse': {
			assert(isVehicleLineService(vehicle.service), 'zoneBrowse requires line service')
			vehicle.setServiceOperator(character)
			return
		}
		default: {
			throw new Error(`allocateVehicleServiceForJob: unexpected job ${(job as Job).job}`)
		}
	}
}

function vehicleHasNoOtherOperator(
	game: Game,
	vehicle: VehicleEntity,
	character: Character
): boolean {
	if (vehicle.operator) return vehicle.operator.uid === character.uid
	for (const c of game.population) {
		if (c === character) continue
		if (c.operates?.uid === vehicle.uid) return false
	}
	return true
}

function pickOffloadForTile(
	tile: Tile,
	storage: Storage
): { looseGood: LooseGood; urgency: number } | undefined {
	const available = tile.availableGoods
	if (available.length === 0) return undefined

	const roomFor = (g: LooseGood) => (storage.hasRoom(g.goodType as GoodType) ?? 0) > 0

	if (tile.content instanceof Alveolus) {
		const coord = toAxialCoord(tile.position)!
		if (tile.content.hive.movingGoods.get(coord)?.length) return undefined
		const looseGood = available.find(roomFor)
		if (!looseGood) return undefined
		return { looseGood, urgency: jobBalance.offload.alveolusBlocked }
	}
	if (tile.zone === 'residential') {
		const looseGood = available.find(roomFor)
		if (!looseGood) return undefined
		return { looseGood, urgency: jobBalance.offload.residentialTile }
	}
	if (tile.content instanceof UnBuiltLand && tile.content.project) {
		const looseGood = available.find(roomFor)
		if (!looseGood) return undefined
		return { looseGood, urgency: jobBalance.offload.projectTile }
	}
	return undefined
}

function findVehicleOffloadJobApproach(
	game: Game,
	character: Character
): VehicleOffloadJob | undefined {
	if (character.driving) return undefined
	if (character.operates) return undefined

	let best:
		| {
				score: number
				vehicle: VehicleEntity
				tile: Tile
				pick: { looseGood: LooseGood; urgency: number }
				pathToVehicle: AxialCoord[]
		  }
		| undefined

	for (const vehicle of game.vehicles) {
		if (vehicle.vehicleType !== LINE_FREIGHT_VEHICLE) continue
		if (vehicle.service) continue
		if (!vehicleHasNoOtherOperator(game, vehicle, character)) continue

		let pathToVehicle = game.hex.findPathForCharacter(
			character.tile.position,
			vehicle.tile.position,
			character,
			maxWalkTime,
			true
		)
		if (!pathToVehicle) continue
		// Same-hex boarding: pathfinding may still return a single-point path; treat as no walk so
		// `work.goWork` + `vehicleOffload` do not schedule redundant `walk.until` steps before boarding.
		if (
			axial.key(axial.round(toAxialCoord(character.position)!)) ===
			axial.key(axial.round(toAxialCoord(vehicle.position)!))
		) {
			pathToVehicle = []
		}

		const origin = toAxialCoord(vehicle.tile.position)!
		for (const tile of game.hex.tiles) {
			const tc = toAxialCoord(tile.position)!
			if (axial.distance(origin, tc) > offloadRange) continue
			const pick = pickOffloadForTile(tile, vehicle.storage)
			if (!pick) continue
			const score = pick.urgency / (pathToVehicle.length + 1)
			if (!best || score > best.score) {
				best = { score, vehicle, tile, pick, pathToVehicle }
			}
		}
	}
	if (!best) return undefined
	const tc = toAxialCoord(best.tile.position)!
	const targetCoord: AxialCoord = { q: tc.q, r: tc.r }
	return {
		job: 'vehicleOffload',
		urgency: best.pick.urgency,
		fatigue: 1,
		vehicleUid: best.vehicle.uid,
		looseGood: best.pick.looseGood,
		targetCoord,
		path: best.pathToVehicle,
	}
}

function findVehicleOffloadJobDriving(
	game: Game,
	character: Character
): VehicleOffloadJob | undefined {
	const vehicle = character.operates
	if (!vehicle) return undefined
	if (vehicle.vehicleType !== LINE_FREIGHT_VEHICLE) return undefined
	if (isVehicleLineService(vehicle.service)) return undefined

	const origin = toAxialCoord(vehicle.tile.position)!
	let best:
		| {
				score: number
				tile: Tile
				pick: { looseGood: LooseGood; urgency: number }
				pathToTile: AxialCoord[]
		  }
		| undefined

	for (const tile of game.hex.tiles) {
		const tc = toAxialCoord(tile.position)!
		if (axial.distance(origin, tc) > offloadRange) continue
		const pick = pickOffloadForTile(tile, vehicle.storage)
		if (!pick) continue
		const here = toAxialCoord(character.position)!
		const sameTile = axial.key(tc) === axial.key(here)
		const pathToTile = game.hex.findPathForCharacter(
			character.position,
			tile.position,
			character,
			maxWalkTime,
			true
		)
		if (!pathToTile && !sameTile) continue
		const path = pathToTile ?? []
		const score = pick.urgency / (path.length + 1)
		if (!best || score > best.score) {
			best = { score, tile, pick, pathToTile: path }
		}
	}
	if (!best) return undefined
	const tc = toAxialCoord(best.tile.position)!
	const targetCoord: AxialCoord = { q: tc.q, r: tc.r }
	return {
		job: 'vehicleOffload',
		urgency: best.pick.urgency,
		fatigue: 1,
		vehicleUid: vehicle.uid,
		looseGood: best.pick.looseGood,
		targetCoord,
		path: best.pathToTile,
	}
}

/** Idle wheelbarrows may propose maintenance offload for burdened tiles within {@link offloadRange}. */
export function findVehicleOffloadJob(
	game: Game,
	character: Character
): VehicleOffloadJob | undefined {
	if (character.driving) return findVehicleOffloadJobDriving(game, character)
	return findVehicleOffloadJobApproach(game, character)
}

export function lineFreightVehicleType(): typeof LINE_FREIGHT_VEHICLE {
	return LINE_FREIGHT_VEHICLE
}

/** Walk to a line-freight wheelbarrow (planner prelude; merged into {@link findVehicleHopJob}). */
export function findVehicleApproachJob(
	game: Game,
	character: Character
): { vehicleUid: string; path: AxialCoord[] } | undefined {
	if (character.driving) return undefined
	if (character.operates) return undefined
	let best: { vehicleUid: string; path: AxialCoord[]; len: number } | undefined
	for (const vehicle of game.vehicles) {
		if (vehicle.vehicleType !== LINE_FREIGHT_VEHICLE) continue
		if (vehicle.servedLines.length === 0) continue
		if (!vehicleHasNoOtherOperator(game, vehicle, character)) continue
		// punctual must be true: false stops one hex short of the vehicle, breaking onboarding.
		// Start from the occupied tile (same as `find.path`), not foot `character.position`, so
		// replanning in `find.pathToVehicle` matches this job when the character is mid-step.
		const path = game.hex.findPathForCharacter(
			character.tile.position,
			vehicle.tile.position,
			character,
			maxWalkTime,
			true
		)
		if (!path) continue
		const len = path.length
		if (!best || len < best.len) best = { vehicleUid: vehicle.uid, path, len }
	}
	if (!best) return undefined
	return { vehicleUid: best.vehicleUid, path: best.path }
}

/** Attach initial line service while already operating the vehicle (merged into {@link findVehicleHopJob}). */
export function findVehicleBeginServiceLeg(
	game: Game,
	character: Character
): { vehicleUid: string; lineId: string; stopId: string } | undefined {
	if (!character.driving || !character.operates) return undefined
	const vehicle = character.operates
	if (vehicle.vehicleType !== LINE_FREIGHT_VEHICLE) return undefined
	if (isVehicleLineService(vehicle.service)) return undefined
	if (vehicle.servedLines.length === 0) return undefined
	const pick = pickInitialVehicleServiceCandidate(game, character, vehicle)
	if (!pick) return undefined
	return { vehicleUid: vehicle.uid, lineId: pick.line.id, stopId: pick.stop.id }
}

/** Same as {@link findVehicleBeginServiceLeg}, as a `vehicleHop` plan with {@link VehicleHopJob.needsBeginService}. */
export function findVehicleBeginServiceJob(
	game: Game,
	character: Character
): VehicleHopJob | undefined {
	const leg = findVehicleBeginServiceLeg(game, character)
	if (!leg) return undefined
	return {
		job: 'vehicleHop',
		urgency: jobBalance.vehicleBeginService,
		fatigue: 1,
		vehicleUid: leg.vehicleUid,
		lineId: leg.lineId,
		stopId: leg.stopId,
		path: [],
		dockEnter: false,
		needsBeginService: true,
	}
}

function zoneBrowseJobFromTileLooseLoad(
	game: Game,
	character: Character
): ZoneBrowseJob | undefined {
	if (!character.driving || !character.operates) return undefined
	const vehicle = character.operates
	if (vehicle.vehicleType !== LINE_FREIGHT_VEHICLE) return undefined
	const svc = vehicle.service
	if (!isVehicleLineService(svc)) return undefined
	if (!('zone' in svc.stop)) return undefined
	const hiveNeeds = aggregateHiveNeedTypes(game)
	const selectable = gatherSelectableGoodTypes(svc.line, hiveNeeds).filter((good) =>
		gatherSegmentAllowsGoodType(svc.line, good)
	)
	const loose = game.hex.looseGoods.getGoodsAt(character.tile.position)
	const storage = vehicle.storage
	const pick = loose.find(
		(g) =>
			g.available &&
			!g.isRemoved &&
			selectable.includes(g.goodType as GoodType) &&
			storage.hasRoom(g.goodType as GoodType) > 0
	)
	if (!pick) return undefined
	const tc = toAxialCoord(character.tile.position)!
	return {
		job: 'zoneBrowse',
		urgency: jobBalance.loadOntoVehicle,
		fatigue: 1,
		vehicleUid: vehicle.uid,
		lineId: svc.line.id,
		stopId: svc.stop.id,
		path: [],
		zoneBrowseAction: 'load',
		goodType: pick.goodType as GoodType,
		quantity: 1,
		targetCoord: tc,
	}
}

/**
 * Same-tile construction provide when {@link pickVehicleZoneBrowseSelection} yields no pick (e.g. gather
 * lines without distribute segments) but surplus cargo can still satisfy an adjacent standalone site.
 */
function zoneBrowseJobFromConstructionProvide(
	game: Game,
	character: Character
): ZoneBrowseJob | undefined {
	if (!character.driving || !character.operates) return undefined
	const vehicle = character.operates
	if (vehicle.vehicleType !== LINE_FREIGHT_VEHICLE) return undefined
	const svc = vehicle.service
	if (!isVehicleLineService(svc)) return undefined
	if (!('zone' in svc.stop) || svc.stop.zone.kind !== 'radius') return undefined

	const utility = zoneBrowseUtilityContext(game, vehicle, svc.line, svc.stop)
	if (!utility) return undefined

	const site = character.tile.content
	if (!isStandaloneBuildSiteShell(site) || site.destroyed || site.isReady) return undefined
	const remainingRaw = site.remainingNeeds
	const remaining =
		remainingRaw && typeof remainingRaw === 'object'
			? remainingRaw
			: ({} as Partial<Record<GoodType, number>>)
	const goodTypes = (Object.keys(remaining) as GoodType[]).filter((g) => (remaining[g] ?? 0) > 0)
	goodTypes.sort()
	for (const goodType of goodTypes) {
		const need = remaining[goodType] ?? 0
		if (need <= 0) continue
		const rawAvail = vehicle.storage.available(goodType)
		const surplus = utility.surplusLoadedGoods[goodType] ?? 0
		const avail = Math.min(rawAvail, surplus)
		if (avail <= 0) continue
		const room = site.storage.hasRoom(goodType) ?? 0
		if (room <= 0) continue
		const quantity = Math.min(need, avail, room)
		if (quantity <= 0) continue
		const tc = toAxialCoord(character.tile.position)!
		return {
			job: 'zoneBrowse',
			urgency: jobBalance.provideFromVehicle,
			fatigue: 1,
			vehicleUid: vehicle.uid,
			lineId: svc.line.id,
			stopId: svc.stop.id,
			path: [],
			zoneBrowseAction: 'provide',
			goodType,
			quantity,
			targetCoord: tc,
		}
	}
	return undefined
}

export function findZoneBrowseJob(game: Game, character: Character): ZoneBrowseJob | undefined {
	if (!character.driving || !character.operates) return undefined
	const vehicle = character.operates
	if (vehicle.vehicleType !== LINE_FREIGHT_VEHICLE) return undefined
	const svc = vehicle.service
	if (!isVehicleLineService(svc)) return undefined
	if ('zone' in svc.stop && svc.stop.zone.kind === 'radius') {
		const selection = pickVehicleZoneBrowseSelection(game, character, vehicle, svc.line, svc.stop)
		if (selection) {
			return {
				job: 'zoneBrowse',
				urgency:
					selection.action === 'load' ? jobBalance.loadOntoVehicle : jobBalance.provideFromVehicle,
				fatigue: 1,
				vehicleUid: vehicle.uid,
				lineId: svc.line.id,
				stopId: svc.stop.id,
				path: selection.path,
				zoneBrowseAction: selection.action,
				goodType: selection.goodType,
				quantity: selection.quantity ?? 1,
				targetCoord: toAxialCoord(selection.targetTile.position)!,
			}
		}
		const construction = zoneBrowseJobFromConstructionProvide(game, character)
		if (construction) return construction
	}
	return zoneBrowseJobFromTileLooseLoad(game, character)
}

/** @internal Tests / diagnostics; same tile loose load surfaced as {@link findZoneBrowseJob}. */
export function findLoadOntoVehicleJob(
	game: Game,
	character: Character
): ZoneBrowseJob | undefined {
	return zoneBrowseJobFromTileLooseLoad(game, character)
}

/** Bay-anchor hive unload is primarily convey-driven; not a planner job (see {@link UnloadFromVehicleProbe}). */
export function findUnloadFromVehicleJob(
	_game: Game,
	character: Character
): UnloadFromVehicleProbe | undefined {
	if (!character.driving || !character.operates) return undefined
	const vehicle = character.operates
	if (vehicle.vehicleType !== LINE_FREIGHT_VEHICLE) return undefined
	const svc = vehicle.service
	if (!isVehicleLineService(svc)) return undefined
	const { line, stop } = svc
	if (!('anchor' in stop)) return undefined
	const content = character.tile.content as Alveolus | undefined
	if (!content || !('hive' in content) || !content.hive) return undefined
	if (!freightStopAnchorMatchesAlveolus(stop.anchor, content)) return undefined
	const stopIdx = line.stops.findIndex((s) => s.id === stop.id)
	if (stopIdx < 0) return undefined
	const segment = findGatherRouteSegments(line).find((seg) => seg.unloadStopIndex === stopIdx)
	if (!segment) return undefined
	if (!('storage' in content) || !content.storage) return undefined
	for (const goodType of Object.keys(vehicle.storage.stock) as GoodType[]) {
		const avail = vehicle.storage.available(goodType)
		if (avail <= 0) continue
		if (!gatherSegmentAllowsGoodTypeForSegment(line, segment, goodType)) continue
		const room = content.storage.hasRoom(goodType) ?? 0
		if (room <= 0) continue
		const quantity = Math.min(avail, room)
		if (quantity <= 0) continue
		return {
			job: 'unloadFromVehicle',
			urgency: jobBalance.unloadFromVehicle,
			fatigue: 1,
			vehicleUid: vehicle.uid,
			goodType,
			quantity,
			path: [],
		}
	}
	return undefined
}

/**
 * @internal Diagnostics helper: filters {@link findZoneBrowseJob} to `zoneBrowseAction: 'provide'`.
 * Logs when a standalone construction site could consume vehicle stock but the wheelbarrow has no line service.
 */
export function findProvideFromVehicleJob(
	game: Game,
	character: Character
): ZoneBrowseJob | undefined {
	if (!character.driving || !character.operates) return undefined
	const vehicle = character.operates
	if (vehicle.vehicleType !== LINE_FREIGHT_VEHICLE) return undefined
	const siteEarly = character.tile.content
	if (
		isStandaloneBuildSiteShell(siteEarly) &&
		!siteEarly.destroyed &&
		!siteEarly.isReady &&
		vehicle.service &&
		!isVehicleLineService(vehicle.service)
	) {
		traces.vehicle?.log?.('vehicleJob.provideFromVehicle.skippedNoLineService', {
			vehicleUid: vehicle.uid,
		})
	}
	const job = findZoneBrowseJob(game, character)
	return job?.zoneBrowseAction === 'provide' ? job : undefined
}

function findVehicleHopJobLineHop(game: Game, character: Character): VehicleHopJob | undefined {
	if (!character.driving || !character.operates) return undefined
	const vehicle = character.operates
	if (vehicle.vehicleType !== LINE_FREIGHT_VEHICLE) return undefined
	const service = vehicle.service
	if (!isVehicleLineService(service)) return undefined
	const projected = projectedLineStopForVehicleHop(game, character, vehicle)
	if (!projected) return undefined
	const { line, stop } = projected
	if (stop.id === service.stop.id && 'zone' in stop && stop.zone.kind === 'radius') return undefined
	let path: AxialCoord[] = []
	let zoneBrowseAction: VehicleHopJob['zoneBrowseAction']
	let goodType: VehicleHopJob['goodType']
	let quantity: VehicleHopJob['quantity']
	let targetCoord: VehicleHopJob['targetCoord']
	if ('zone' in stop && stop.zone.kind === 'radius') {
		const selection = pickVehicleZoneBrowseSelection(game, character, vehicle, line, stop)
		if (!selection) return undefined
		path = selection.path
		zoneBrowseAction = selection.action
		goodType = selection.goodType
		quantity = selection.quantity
		targetCoord = toAxialCoord(selection.targetTile.position)!
	} else {
		const targetPos = freightStopMovementTarget(game, character, line, stop)
		if (!targetPos) return undefined
		path =
			game.hex.findPathForCharacter(character.position, targetPos, character, maxWalkTime, false) ??
			[]
		const sameTile =
			axial.key(toAxialCoord(character.position)!) === axial.key(toAxialCoord(targetPos)!)
		if (path.length === 0 && !sameTile) return undefined
	}
	return {
		job: 'vehicleHop',
		urgency: jobBalance.vehicleHop,
		fatigue: 1,
		vehicleUid: vehicle.uid,
		lineId: line.id,
		stopId: stop.id,
		path,
		dockEnter: 'anchor' in stop,
		zoneBrowseAction,
		goodType,
		quantity,
		targetCoord,
	}
}

/**
 * Line-hop (and merged approach / begin-service preludes). Planner-visible vehicle movement along a line;
 * walking to the wheelbarrow and attaching {@link VehicleEntity.service} are script preludes, not separate jobs.
 */
export function findVehicleHopJob(game: Game, character: Character): VehicleHopJob | undefined {
	const lineHop = findVehicleHopJobLineHop(game, character)
	if (lineHop) return lineHop

	const beginLeg = findVehicleBeginServiceLeg(game, character)
	if (beginLeg) {
		const vehicle = character.operates
		if (!vehicle || vehicle.uid !== beginLeg.vehicleUid) return undefined
		return {
			job: 'vehicleHop',
			urgency: jobBalance.vehicleBeginService,
			fatigue: 1,
			vehicleUid: beginLeg.vehicleUid,
			lineId: beginLeg.lineId,
			stopId: beginLeg.stopId,
			path: [],
			dockEnter: false,
			needsBeginService: true,
		}
	}

	const approach = findVehicleApproachJob(game, character)
	if (!approach) return undefined
	const vehicle = game.vehicles.vehicle(approach.vehicleUid)
	if (!vehicle) return undefined
	const pick = pickInitialVehicleServiceCandidate(game, character, vehicle)
	if (!pick) return undefined
	return {
		job: 'vehicleHop',
		urgency: Math.max(jobBalance.vehicleHop, jobBalance.vehicleApproach),
		fatigue: 1,
		vehicleUid: approach.vehicleUid,
		lineId: pick.line.id,
		stopId: pick.stop.id,
		path: [],
		dockEnter: false,
		approachPath: approach.path,
	}
}

export interface VehicleWorkPick {
	readonly job: VehicleHopJob | ZoneBrowseJob | VehicleOffloadJob
	readonly targetTile: Tile
}

/** Planner-visible vehicle work: line-hop (incl. approach / begin-service preludes), zone-browse, loose-good offload. */
export function collectVehicleWorkPicks(game: Game, character: Character): VehicleWorkPick[] {
	const out: VehicleWorkPick[] = []
	const zoneBrowse = findZoneBrowseJob(game, character)
	if (zoneBrowse) {
		const v = game.vehicles.vehicle(zoneBrowse.vehicleUid)
		if (v) out.push({ job: zoneBrowse, targetTile: v.tile })
	}
	const hop = findVehicleHopJob(game, character)
	if (hop) {
		const v = game.vehicles.vehicle(hop.vehicleUid)
		if (v) out.push({ job: hop, targetTile: v.tile })
	}
	const offload = findVehicleOffloadJob(game, character)
	if (offload) {
		const v = game.vehicles.vehicle(offload.vehicleUid)
		if (v) out.push({ job: offload, targetTile: v.tile })
	}
	return out
}

export { findVehicleEntityAtTile } from './vehicle-run'
