import { jobBalance, offloadRange } from 'engine-rules'
import { Alveolus } from 'ssh/board/content/alveolus'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { LooseGood } from 'ssh/board/looseGoods'
import type { Tile } from 'ssh/board/tile'
import { isStandaloneBuildSiteShell } from 'ssh/build-site'
import {
	findGatherRouteSegments,
	freightStopAnchorMatchesAlveolus,
	gatherSegmentAllowsGoodType,
	gatherSegmentAllowsGoodTypeForSegment,
	gatherSelectableGoodTypes,
} from 'ssh/freight/freight-line'
import { aggregateHiveNeedTypes } from 'ssh/freight/freight-zone-gather-target'
import { scoreVehicleCandidate } from 'ssh/freight/vehicle-candidate-policy'
import {
	ensureVehicleServiceStarted,
	freightStopMovementTarget,
	gatherUnloadAnchorHiveDemandsGood,
	pickInitialVehicleServiceCandidate,
	projectedLineStopForVehicleHop,
	vehicleNeedsParkingOnCurrentTile,
} from 'ssh/freight/vehicle-run'
import {
	inferZoneLoadAdSource,
	pickVehicleZoneBrowseSelection,
	zoneBrowseLoadPriorityTier,
	zoneBrowseUrgency,
	zoneBrowseUtilityContext,
} from 'ssh/freight/vehicle-zone-browse'
import type { Game } from 'ssh/game/game'
import type { Character } from 'ssh/population/character'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import {
	isVehicleLineService,
	isVehicleMaintenanceService,
	type VehicleMaintenanceService,
} from 'ssh/population/vehicle/vehicle'
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
import { assert, traces } from '../dev/debug.ts'

const LINE_FREIGHT_VEHICLE = 'wheelbarrow' as const

function vehicleHasStock(vehicle: VehicleEntity): boolean {
	return Object.values(vehicle.storage.stock).some((n) => (n ?? 0) > 0)
}

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
			// Discard any prior maintenance service: each offload run gets a fresh per-kind service.
			if (isVehicleMaintenanceService(vehicle.service)) {
				vehicle.endService()
			}
			if (job.maintenanceKind === 'loadFromBurden') {
				vehicle.beginMaintenanceService(
					{
						kind: 'loadFromBurden',
						looseGood: job.looseGood,
						targetCoord: job.targetCoord,
					},
					character
				)
			} else if (job.maintenanceKind === 'unloadToTile') {
				vehicle.beginMaintenanceService(
					{ kind: 'unloadToTile', targetCoord: job.targetCoord },
					character
				)
			} else {
				vehicle.beginMaintenanceService({ kind: 'park', targetCoord: job.targetCoord }, character)
			}
			return
		}
		case 'vehicleHop': {
			if (job.approachPath?.length) {
				// Approach still claims the selected service immediately so another worker cannot pick the
				// same wheelbarrow while this one is walking toward it. Physical boarding remains in
				// `vehicleApproachStep` after the worker reaches the vehicle.
				assert(
					ensureVehicleServiceStarted(vehicle, character, game, character, {
						lineId: job.lineId,
						stopId: job.stopId,
					}),
					'vehicleHop approach: could not reserve selected line service'
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

/**
 * Tile is a legal drop target for `unloadToTile` / `park`: undeveloped, not under construction,
 * not residential, not currently burdened. The vehicle's own tile is excluded by callers.
 */
function isTileDropEligible(tile: Tile): boolean {
	if (!(tile.content instanceof UnBuiltLand)) return false
	if (tile.content.project) return false
	if (tile.zone === 'residential') return false
	if (tile.isBurdened) return false
	return true
}

function vehicleCanReachMaintenanceTarget(
	game: Game,
	vehicle: VehicleEntity,
	character: Character,
	tile: Tile
): boolean {
	const from = toAxialCoord(vehicle.position)
	const to = toAxialCoord(tile.position)
	if (!from || !to) return false
	const start = axial.round(from)
	const goal = axial.round(to)
	if (axial.key(start) === axial.key(goal)) return true
	return !!game.hex.findPathForCharacter(start, goal, character, maxWalkTime, true)
}

/**
 * Picks a non-burdening tile within {@link offloadRange} of `vehicle` to drop loaded cargo onto.
 * Score prefers nearest, with a mild penalty proportional to existing loose-goods on the tile so we
 * don't pile on the same hex. Returns `undefined` when storage is empty or no tile fits.
 */
function pickUnloadTargetForVehicle(
	game: Game,
	vehicle: VehicleEntity,
	canReach: (tile: Tile) => boolean = () => true
): { tile: Tile; urgency: number } | undefined {
	if (!vehicleHasStock(vehicle)) return undefined
	const origin = toAxialCoord(vehicle.tile.position)!
	let best: { tile: Tile; score: number } | undefined
	for (const tile of game.hex.tiles) {
		const tc = toAxialCoord(tile.position)!
		const dist = axial.distance(origin, tc)
		if (dist > offloadRange) continue
		if (axial.key(tc) === axial.key(origin)) continue
		if (!isTileDropEligible(tile)) continue
		if (!canReach(tile)) continue
		const looseCount = game.hex.looseGoods.getGoodsAt(tc).length
		// Distance dominates; mild crowding penalty avoids piling on the same hex.
		const score = 1 / (dist + 1) / (1 + 0.25 * looseCount)
		if (!best || score > best.score) best = { tile, score }
	}
	if (!best) return undefined
	return { tile: best.tile, urgency: jobBalance.offload.unloadToTile }
}

/**
 * Picks the nearest non-burdening parking tile for an empty wheelbarrow that itself burdens its
 * current hex. Ties broken by lowest count of already-parked vehicles among 6-neighbors so parking
 * spreads rather than clustering. Returns `undefined` when no eligible tile exists in range.
 */
function pickParkingTargetForVehicle(
	game: Game,
	vehicle: VehicleEntity,
	canReach: (tile: Tile) => boolean = () => true
): { tile: Tile; urgency: number } | undefined {
	if (vehicleHasStock(vehicle)) return undefined
	if (!vehicleNeedsParkingOnCurrentTile(vehicle)) return undefined
	const origin = toAxialCoord(vehicle.tile.position)!
	const parkedNeighborCount = (tc: AxialCoord): number => {
		let count = 0
		for (const v of game.vehicles) {
			if (v.uid === vehicle.uid) continue
			if (v.vehicleType !== LINE_FREIGHT_VEHICLE) continue
			const vp = toAxialCoord(v.position)
			if (!vp) continue
			const vc: AxialCoord = { q: Math.round(vp.q), r: Math.round(vp.r) }
			if (axial.distance(tc, vc) <= 1) count++
		}
		return count
	}
	let best: { tile: Tile; dist: number; cluster: number } | undefined
	for (const tile of game.hex.tiles) {
		const tc = toAxialCoord(tile.position)!
		const dist = axial.distance(origin, tc)
		if (dist > offloadRange) continue
		if (axial.key(tc) === axial.key(origin)) continue
		if (!isTileDropEligible(tile)) continue
		if (!canReach(tile)) continue
		const cluster = parkedNeighborCount(tc)
		if (!best || dist < best.dist || (dist === best.dist && cluster < best.cluster)) {
			best = { tile, dist, cluster }
		}
	}
	if (!best) return undefined
	return { tile: best.tile, urgency: jobBalance.offload.park }
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

type LoadCandidate = {
	kind: 'load'
	tile: Tile
	pick: { looseGood: LooseGood; urgency: number }
}
type UnloadCandidate = { kind: 'unload'; tile: Tile; urgency: number }
type ParkCandidate = { kind: 'park'; tile: Tile; urgency: number }
type MaintenanceCandidate = LoadCandidate | UnloadCandidate | ParkCandidate

function loadedStockCanEnterServedGatherLine(game: Game, vehicle: VehicleEntity): boolean {
	const goods = (Object.keys(vehicle.storage.stock) as GoodType[]).filter(
		(good) => vehicle.storage.available(good) > 0
	)
	if (goods.length === 0) return false
	const vehicleCoord = toAxialCoord(vehicle.position)
	if (!vehicleCoord) return false
	for (const line of vehicle.servedLines) {
		for (const segment of findGatherRouteSegments(line)) {
			if (segment.loadStopIndex !== 0) continue
			const loadStop = line.stops[segment.loadStopIndex]
			const unloadStop = line.stops[segment.unloadStopIndex]
			if (!loadStop || !('zone' in loadStop) || loadStop.zone.kind !== 'radius') continue
			if (!unloadStop) continue
			const center: AxialCoord = { q: loadStop.zone.center[0], r: loadStop.zone.center[1] }
			if (axial.distance(center, vehicleCoord) > loadStop.zone.radius) continue
			if (
				goods.some(
					(good) =>
						gatherSegmentAllowsGoodTypeForSegment(line, segment, good) &&
						gatherUnloadAnchorHiveDemandsGood(game, unloadStop, good)
				)
			) {
				return true
			}
		}
	}
	return false
}

function maintenanceCandidateUrgency(candidate: MaintenanceCandidate): number {
	return candidate.kind === 'load' ? candidate.pick.urgency : candidate.urgency
}

function maintenanceCandidateScore(candidate: MaintenanceCandidate, distance: number): number {
	return scoreVehicleCandidate({
		kind:
			candidate.kind === 'load'
				? 'maintenanceLoad'
				: candidate.kind === 'unload'
					? 'maintenanceUnload'
					: 'park',
		urgency: maintenanceCandidateUrgency(candidate),
		distance,
	}).score
}

function isJointLineLoadCandidate(
	character: Character,
	vehicle: VehicleEntity,
	candidate: LoadCandidate
): boolean {
	const candidateCoord = toAxialCoord(candidate.tile.position)
	if (!candidateCoord) return false
	for (const line of vehicle.servedLines) {
		for (const segment of findGatherRouteSegments(line)) {
			const stop = line.stops[segment.loadStopIndex]
			if (!stop || !('zone' in stop) || stop.zone.kind !== 'radius') continue
			const selection = pickVehicleZoneBrowseSelection(
				vehicle.game,
				character,
				vehicle,
				line,
				stop,
				vehicle.position
			)
			if (selection?.action !== 'load') continue
			const selectionCoord = toAxialCoord(selection.targetTile.position)
			if (!selectionCoord || axial.key(selectionCoord) !== axial.key(candidateCoord)) continue
			if (selection.goodType !== candidate.pick.looseGood.goodType) continue
			return true
		}
	}
	return false
}

/**
 * Picks the best maintenance target for `vehicle`. Load and unload candidates compete head-to-head
 * (path length is the same for both — `pathLength` is the operator's walk to the vehicle, not from
 * the vehicle to the target). Park is only considered when **no** load or unload candidate exists.
 */
function pickMaintenanceForVehicle(
	game: Game,
	vehicle: VehicleEntity,
	character: Character
): MaintenanceCandidate | undefined {
	// Structural "could begin gather line from loaded cargo" must not suppress maintenance unless
	// begin-service is actually actionable for this worker (path, unload anchor, zone load, etc.).
	if (
		loadedStockCanEnterServedGatherLine(game, vehicle) &&
		pickInitialVehicleServiceCandidate(game, character, vehicle)
	) {
		return undefined
	}
	const canReach = (tile: Tile) => vehicleCanReachMaintenanceTarget(game, vehicle, character, tile)
	const origin = toAxialCoord(vehicle.tile.position)!
	let bestLoad: LoadCandidate | undefined
	let bestLoadDistance = Number.POSITIVE_INFINITY
	for (const tile of game.hex.tiles) {
		const tc = toAxialCoord(tile.position)!
		const dist = axial.distance(origin, tc)
		if (dist > offloadRange) continue
		if (!canReach(tile)) continue
		const pick = pickOffloadForTile(tile, vehicle.storage)
		if (!pick) continue
		const candidate: LoadCandidate = { kind: 'load', tile, pick }
		if (dist < bestLoadDistance) {
			bestLoad = candidate
			bestLoadDistance = dist
		}
	}
	const unload = pickUnloadTargetForVehicle(game, vehicle, canReach)
	let bestUnload: UnloadCandidate | undefined
	let bestUnloadDistance = Number.POSITIVE_INFINITY
	if (unload) {
		const tc = toAxialCoord(unload.tile.position)!
		bestUnload = { kind: 'unload', tile: unload.tile, urgency: unload.urgency }
		bestUnloadDistance = axial.distance(origin, tc)
	}
	if (bestLoad || bestUnload) {
		if (bestLoad && bestLoadDistance <= bestUnloadDistance) return bestLoad
		if (bestUnload) return bestUnload
	}
	const park = pickParkingTargetForVehicle(game, vehicle, canReach)
	if (park) return { kind: 'park', tile: park.tile, urgency: park.urgency }
	return undefined
}

function maintenanceCandidateToJob(
	candidate: MaintenanceCandidate,
	vehicle: VehicleEntity,
	path: AxialCoord[]
): VehicleOffloadJob {
	const tc = toAxialCoord(candidate.tile.position)!
	const targetCoord: AxialCoord = { q: tc.q, r: tc.r }
	const base = {
		job: 'vehicleOffload' as const,
		fatigue: 1,
		vehicleUid: vehicle.uid,
		targetCoord,
		approachPath: path,
		path,
	}
	if (candidate.kind === 'load') {
		return {
			...base,
			maintenanceKind: 'loadFromBurden',
			urgency: candidate.pick.urgency,
			looseGood: candidate.pick.looseGood,
		}
	}
	if (candidate.kind === 'unload') {
		return { ...base, maintenanceKind: 'unloadToTile', urgency: candidate.urgency }
	}
	return { ...base, maintenanceKind: 'park', urgency: candidate.urgency }
}

function maintenanceServiceToJob(
	service: VehicleMaintenanceService,
	vehicle: VehicleEntity,
	path: AxialCoord[]
): VehicleOffloadJob | undefined {
	const base = {
		job: 'vehicleOffload' as const,
		fatigue: 1,
		vehicleUid: vehicle.uid,
		targetCoord: service.targetCoord,
		approachPath: path,
		path,
	}
	if (service.kind === 'loadFromBurden') {
		if (!service.looseGood.available || service.looseGood.isRemoved) return undefined
		return {
			...base,
			maintenanceKind: 'loadFromBurden',
			urgency: jobBalance.offload.alveolusBlocked,
			looseGood: service.looseGood,
		}
	}
	if (service.kind === 'unloadToTile') {
		if (!vehicleHasStock(vehicle)) return undefined
		return { ...base, maintenanceKind: 'unloadToTile', urgency: jobBalance.offload.unloadToTile }
	}
	if (vehicleHasStock(vehicle)) return undefined
	return { ...base, maintenanceKind: 'park', urgency: jobBalance.offload.park }
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
				candidate: MaintenanceCandidate
				pathToVehicle: AxialCoord[]
		  }
		| undefined

	for (const vehicle of game.vehicles) {
		if (vehicle.vehicleType !== LINE_FREIGHT_VEHICLE) continue
		if (!vehicleHasNoOtherOperator(game, vehicle, character)) continue

		const sameVehicleHex =
			axial.key(axial.round(toAxialCoord(character.position)!)) ===
			axial.key(axial.round(toAxialCoord(vehicle.position)!))
		const pathToVehicle = sameVehicleHex
			? []
			: game.hex.findPathForCharacter(
					character.tile.position,
					vehicle.tile.position,
					character,
					maxWalkTime,
					true
				)
		if (!pathToVehicle) continue

		const service = vehicle.service
		if (isVehicleMaintenanceService(service)) {
			const job = maintenanceServiceToJob(service, vehicle, pathToVehicle)
			if (!job) continue
			const tile = game.hex.getTile(service.targetCoord)
			if (!tile) continue
			if (!vehicleCanReachMaintenanceTarget(game, vehicle, character, tile)) continue
			const candidate: MaintenanceCandidate =
				service.kind === 'loadFromBurden'
					? {
							kind: 'load',
							tile,
							pick: { looseGood: service.looseGood, urgency: job.urgency },
						}
					: service.kind === 'park'
						? {
								kind: 'park',
								tile,
								urgency: job.urgency,
							}
						: {
								kind: 'unload',
								tile,
								urgency: job.urgency,
							}
			const score = maintenanceCandidateScore(candidate, pathToVehicle.length)
			if (!best || score > best.score) {
				best = {
					score,
					vehicle,
					candidate,
					pathToVehicle,
				}
			}
			continue
		}
		if (service) continue

		const candidate = pickMaintenanceForVehicle(game, vehicle, character)
		if (!candidate) continue
		if (candidate.kind === 'load' && isJointLineLoadCandidate(character, vehicle, candidate)) {
			continue
		}
		const score = maintenanceCandidateScore(candidate, pathToVehicle.length)
		if (!best || score > best.score) {
			best = { score, vehicle, candidate, pathToVehicle }
		}
	}
	if (!best) return undefined
	return maintenanceCandidateToJob(best.candidate, best.vehicle, best.pathToVehicle)
}

function findVehicleOffloadJobDriving(
	game: Game,
	character: Character
): VehicleOffloadJob | undefined {
	const vehicle = character.operates
	if (!vehicle) return undefined
	if (vehicle.vehicleType !== LINE_FREIGHT_VEHICLE) return undefined
	if (isVehicleLineService(vehicle.service)) return undefined
	// Respect the current maintenance run: switching mid-script (e.g. picking a fresh `load`
	// while still dropping the previous one) cancels the active job and leaves stock stranded.
	// The planner re-picks naturally on the next turn after the script offboards.
	if (isVehicleMaintenanceService(vehicle.service)) return undefined

	const candidate = pickMaintenanceForVehicle(game, vehicle, character)
	if (!candidate) return undefined
	if (candidate.kind === 'load' && isJointLineLoadCandidate(character, vehicle, candidate)) {
		return undefined
	}
	const tc = toAxialCoord(candidate.tile.position)!
	const here = toAxialCoord(character.position)!
	const sameTile = axial.key(tc) === axial.key(here)
	const pathToTile = game.hex.findPathForCharacter(
		character.position,
		candidate.tile.position,
		character,
		maxWalkTime,
		true
	)
	if (!pathToTile && !sameTile) return undefined
	return maintenanceCandidateToJob(candidate, vehicle, [])
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
		if (!vehicleHasNoOtherOperator(game, vehicle, character)) continue
		const service = vehicle.service
		if (isVehicleMaintenanceService(service)) continue
		if (isVehicleLineService(service)) {
			// Discovery is read-only: dock completion/advancement is handled by `vehicleHopPrepare`.
			if (service.docked && 'anchor' in service.stop) continue
		} else {
			if (vehicle.servedLines.length === 0) continue
			// Loaded begin-line is only allowed when cargo already matches a served gather segment.
			if (vehicleHasStock(vehicle) && !pickInitialVehicleServiceCandidate(game, character, vehicle))
				continue
		}
		const sameVehicleHex =
			axial.key(axial.round(toAxialCoord(character.position)!)) ===
			axial.key(axial.round(toAxialCoord(vehicle.position)!))
		// punctual must be true: false stops one hex short of the vehicle, breaking onboarding.
		// Start from the occupied tile (same as `find.path`), not foot `character.position`, so
		// replanning in `find.pathToVehicle` matches this job when the character is mid-step.
		const path = sameVehicleHex
			? []
			: game.hex.findPathForCharacter(
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
	if (isVehicleMaintenanceService(vehicle.service)) return undefined
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
		approachPath: [],
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
	const adSource = inferZoneLoadAdSource(character.tile)
	const priorityTier = zoneBrowseLoadPriorityTier(adSource)
	return {
		job: 'zoneBrowse',
		urgency: zoneBrowseUrgency('load', priorityTier),
		fatigue: 1,
		vehicleUid: vehicle.uid,
		lineId: svc.line.id,
		stopId: svc.stop.id,
		path: [],
		approachPath: [],
		zoneBrowseAction: 'load',
		goodType: pick.goodType as GoodType,
		quantity: 1,
		targetCoord: tc,
		adSource,
		priorityTier,
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
			urgency: zoneBrowseUrgency('provide', 'pureOffload'),
			fatigue: 1,
			vehicleUid: vehicle.uid,
			lineId: svc.line.id,
			stopId: svc.stop.id,
			path: [],
			approachPath: [],
			zoneBrowseAction: 'provide',
			goodType,
			quantity,
			targetCoord: tc,
			adSource: 'project',
			priorityTier: 'pureOffload',
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
				urgency: zoneBrowseUrgency(selection.action, selection.priorityTier),
				fatigue: 1,
				vehicleUid: vehicle.uid,
				lineId: svc.line.id,
				stopId: svc.stop.id,
				path: selection.path,
				approachPath: [],
				zoneBrowseAction: selection.action,
				goodType: selection.goodType,
				quantity: selection.quantity ?? 1,
				targetCoord: toAxialCoord(selection.targetTile.position)!,
				adSource: selection.adSource,
				priorityTier: selection.priorityTier,
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
		traces.vehicle.log?.('vehicleJob.provideFromVehicle.skippedNoLineService', {
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
		return {
			job: 'vehicleHop',
			urgency: jobBalance.vehicleHop,
			fatigue: 1,
			vehicleUid: vehicle.uid,
			lineId: line.id,
			stopId: stop.id,
			path,
			approachPath: [],
			dockEnter: 'anchor' in stop,
			zoneBrowseAction,
			goodType,
			quantity,
			targetCoord,
			adSource: selection.adSource,
			priorityTier: selection.priorityTier,
		}
	} else {
		const targetPos = freightStopMovementTarget(game, character, line, stop)
		if (!targetPos) return undefined
		const startPos = axial.round(toAxialCoord(character.position)!)
		path = game.hex.findPathForCharacter(startPos, targetPos, character, maxWalkTime, false) ?? []
		// Use rounded hex, not raw fractional keys: foot/vehicle position on a tile must match the
		// anchor tile even when sub-hex coords differ from the tile center.
		const sameHex = axial.key(startPos) === axial.key(axial.round(toAxialCoord(targetPos)!))
		if (path.length === 0 && !sameHex) return undefined
	}
	return {
		job: 'vehicleHop',
		urgency: jobBalance.vehicleHop,
		fatigue: 1,
		vehicleUid: vehicle.uid,
		lineId: line.id,
		stopId: stop.id,
		path,
		approachPath: [],
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
			approachPath: [],
			dockEnter: false,
			needsBeginService: true,
		}
	}

	const approach = findVehicleApproachJob(game, character)
	if (!approach) return undefined
	const vehicle = game.vehicles.vehicle(approach.vehicleUid)
	if (!vehicle) return undefined
	const service = vehicle.service
	if (isVehicleMaintenanceService(service)) return undefined
	const pick = isVehicleLineService(service)
		? projectedLineStopForVehicleHop(game, character, vehicle)
		: pickInitialVehicleServiceCandidate(game, character, vehicle)
	if (!pick) return undefined
	const needsBeginService = !isVehicleLineService(service)
	let path: AxialCoord[] = []
	let zoneBrowseAction: VehicleHopJob['zoneBrowseAction']
	let goodType: VehicleHopJob['goodType']
	let quantity: VehicleHopJob['quantity']
	let targetCoord: VehicleHopJob['targetCoord']
	let adSource: VehicleHopJob['adSource']
	let priorityTier: VehicleHopJob['priorityTier']
	if ('zone' in pick.stop && pick.stop.zone.kind === 'radius') {
		const selection = pickVehicleZoneBrowseSelection(
			game,
			character,
			vehicle,
			pick.line,
			pick.stop,
			vehicle.position
		)
		if (!selection) return undefined
		path = selection.path
		zoneBrowseAction = selection.action
		goodType = selection.goodType
		quantity = selection.quantity
		targetCoord = toAxialCoord(selection.targetTile.position)!
		adSource = selection.adSource
		priorityTier = selection.priorityTier
	} else {
		const targetPos = freightStopMovementTarget(game, character, pick.line, pick.stop)
		if (targetPos) {
			const startPos = axial.round(toAxialCoord(vehicle.position)!)
			path = game.hex.findPathForCharacter(startPos, targetPos, character, maxWalkTime, false) ?? []
		}
		// Match line-hop anchor: do not offer a 0-step drive to an anchor the vehicle is not on.
		if ('anchor' in pick.stop) {
			if (!targetPos) return undefined
			const sameHex =
				axial.key(axial.round(toAxialCoord(vehicle.position)!)) ===
				axial.key(axial.round(toAxialCoord(targetPos)!))
			if (path.length === 0 && !sameHex) return undefined
		}
	}
	return {
		job: 'vehicleHop',
		urgency: Math.max(jobBalance.vehicleHop, jobBalance.vehicleApproach),
		fatigue: 1,
		vehicleUid: approach.vehicleUid,
		lineId: pick.line.id,
		stopId: pick.stop.id,
		path,
		dockEnter: 'anchor' in pick.stop,
		approachPath: approach.path,
		...(zoneBrowseAction ? { zoneBrowseAction } : {}),
		...(goodType ? { goodType } : {}),
		...(quantity !== undefined ? { quantity } : {}),
		...(targetCoord ? { targetCoord } : {}),
		...(adSource ? { adSource } : {}),
		...(priorityTier ? { priorityTier } : {}),
		...(needsBeginService ? { needsBeginService } : {}),
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
