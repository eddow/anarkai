import {
	assertDockedSemantics,
	assertDrivingVehicleSeam,
	assertVehicleOperationConsistency,
	traceVehicleStockWithoutService,
	vehicleTraceAssert,
} from 'ssh/freight/vehicle-invariants'
import {
	disembarkOperatorLeavingDockedVehicleInService,
	ensureVehicleServiceStarted,
	executeNpcTradeStopAndAdvance,
	freightStopMovementTarget,
	maybeAdvanceVehicleFromCompletedAnchorStop,
	maybeAdvanceVehiclePastCompletedZoneStop,
	offboardOperatorAfterFreightWorkComplete,
} from 'ssh/freight/vehicle-run'
import { beginLoadedVehicleUnloadMaintenance } from 'ssh/freight/vehicle-work'
import type { Character } from 'ssh/population/character'
import type { Vehicle } from 'ssh/population/vehicle/entity'
import { isVehicleLineService, isVehicleMaintenanceService } from 'ssh/population/vehicle/vehicle'
import { contract } from 'ssh/types'
import { type AxialCoord, axial } from 'ssh/utils'
import { positionRoughlyEquals, toAxialCoord } from 'ssh/utils/position'
import { assert, traces } from '../../dev/debug.ts'
import { subject } from '../scripts'
import { DurationStep, MoveToStep } from '../steps'
import type { WorkPlan } from '.'
import { characterWalkDuration } from './walk'

type VehicleHopRunEndedReason = 'zone-complete-ended-run' | 'anchor-freight-drained-ended-run'

function vehicleServiceTargetCoord(jobPlan: WorkPlan): AxialCoord | undefined {
	if (jobPlan.type !== 'work') return undefined
	if (!('targetCoord' in jobPlan)) return undefined
	const coord = jobPlan.targetCoord
	return coord ? axial.round(toAxialCoord(coord)!) : undefined
}

function vehicleServiceTargetIsBlocking(character: Character, jobPlan: WorkPlan): boolean {
	const coord = vehicleServiceTargetCoord(jobPlan)
	if (!coord) return false
	return !!character.game.hex.getTile(coord)?.isBlockingSpace
}

function vehicleCanDockAtCurrentPosition(vehicle: Vehicle): boolean {
	const dockTile = vehicle.dockTile
	const position = vehicle.position
	if (!dockTile || !position) return false
	const rawVehicleCoord = toAxialCoord(position)!
	const vehicleCoord = axial.round(rawVehicleCoord)
	const dockCoord = axial.round(toAxialCoord(dockTile.position)!)
	if (axial.key(vehicleCoord) === axial.key(dockCoord)) return true
	const border = vehicle.game.hex.getBorder(rawVehicleCoord)
	if (
		border &&
		(axial.key(toAxialCoord(border.tile.a.position)!) === axial.key(dockCoord) ||
			axial.key(toAxialCoord(border.tile.b.position)!) === axial.key(dockCoord))
	) {
		return true
	}
	const vehicleTile = vehicle.game.hex.getTile(vehicleCoord)
	return !!vehicleTile?.borderWith(dockTile)
}

function refreshAnchorHopPathToLiveDock(
	character: Character,
	vehicle: Vehicle,
	jobPlan: WorkPlan
): AxialCoord[] | undefined {
	if (jobPlan.type !== 'work' || jobPlan.job !== 'vehicleHop') return undefined
	if (!isVehicleLineService(vehicle.service)) return undefined
	const { line, stop } = vehicle.service
	if (!('anchor' in stop)) return undefined
	if (vehicleCanDockAtCurrentPosition(vehicle)) return undefined
	if (jobPlan.line !== line || jobPlan.stop !== stop) {
		traces.vehicle.warn?.('vehicleHopPrepare: stale dock tail against drifted live stop', {
			characterUid: character.uid,
			plannedLineId: jobPlan.lineId,
			plannedStopId: jobPlan.stopId,
			actualLineId: line.id,
			actualStopId: stop.id,
			vehicleCoord: toAxialCoord(vehicle.effectivePosition),
			dockCoord: vehicle.dockTile ? toAxialCoord(vehicle.dockTile.position) : undefined,
		})
	}
	const targetPos = freightStopMovementTarget(character.game, character, line, stop)
	if (!targetPos) return undefined
	const startPos = axial.round(toAxialCoord(vehicle.effectivePosition)!)
	const path =
		character.game.hex.findPathForVehicleServiceBorder(
			startPos,
			targetPos,
			Number.POSITIVE_INFINITY
		) ?? []
	if (path.length === 0) {
		;(jobPlan as WorkPlan & { vehicleHopReplanRequired?: boolean }).vehicleHopReplanRequired = true
		traces.vehicle.warn?.('vehicleHopPrepare: no path to live dock anchor', {
			characterUid: character.uid,
			lineId: line.id,
			stopId: stop.id,
			startCoord: startPos,
			targetCoord: toAxialCoord(targetPos),
		})
		return undefined
	}
	jobPlan.path = path
	traces.vehicle.log?.('vehicleHopPrepare: refreshed live dock path', {
		characterUid: character.uid,
		lineId: line.id,
		stopId: stop.id,
		plannedLineId: jobPlan.lineId,
		plannedStopId: jobPlan.stopId,
		pathLen: path.length,
		startCoord: startPos,
		targetHex: axial.round(toAxialCoord(targetPos)!),
		targetCoord: toAxialCoord(targetPos),
	})
	return path
}

function moveTowardLiveDockStep(
	character: Character,
	vehicle: Vehicle,
	jobPlan: WorkPlan
): MoveToStep | undefined {
	const path = refreshAnchorHopPathToLiveDock(character, vehicle, jobPlan)
	const from = axial.round(toAxialCoord(vehicle.effectivePosition)!)
	const next = path?.find((step) => axial.key(axial.round(step)) !== axial.key(from))
	if (!next) return undefined
	const pathLen = path?.length ?? 0
	const duration = characterWalkDuration(character, from, next)
	if (!Number.isFinite(duration) || duration <= 0) return undefined
	const dockCoord = vehicle.dockTile
		? axial.round(toAxialCoord(vehicle.dockTile.position)!)
		: undefined
	const distanceToDock = dockCoord ? axial.distance(from, dockCoord) : Number.POSITIVE_INFINITY
	const isNearDock = distanceToDock <= 1
	const plannedLineId =
		jobPlan.type === 'work' && jobPlan.job === 'vehicleHop' ? jobPlan.lineId : undefined
	const plannedStopId =
		jobPlan.type === 'work' && jobPlan.job === 'vehicleHop' ? jobPlan.stopId : undefined
	const logMethod = isNearDock ? traces.vehicle.warn : traces.vehicle.log
	const message = isNearDock
		? 'vehicleHopDockStep: recovering stale dock tail by moving toward dock'
		: 'vehicleHopDockStep: continuing approach toward dock'
	logMethod?.(message, {
		characterUid: character.uid,
		lineId: isVehicleLineService(vehicle.service) ? vehicle.service.line.id : undefined,
		stopId: isVehicleLineService(vehicle.service) ? vehicle.service.stop.id : undefined,
		plannedLineId,
		plannedStopId,
		from,
		next,
		pathLen,
		distanceToDock,
		vehicleCoordRaw: vehicle.position ? toAxialCoord(vehicle.position) : undefined,
		dockCoord: vehicle.dockTile ? toAxialCoord(vehicle.dockTile.position) : undefined,
		canDockNow: vehicleCanDockAtCurrentPosition(vehicle),
	})
	return new MoveToStep(
		duration,
		character,
		next,
		'walk',
		'vehicleHop.recoverDockPath'
	).onFulfilled(() => {
		traces.vehicle.log?.('vehicleHopDockStep: recovered stale dock tail movement completed', {
			characterUid: character.uid,
			from,
			next,
			vehicleCoord: vehicle.position ? axial.round(toAxialCoord(vehicle.position)!) : undefined,
			dockable: vehicleCanDockAtCurrentPosition(vehicle),
		})
	})
}

function markVehicleHopRunEndedBeforeDock(
	jobPlan: WorkPlan,
	reason: VehicleHopRunEndedReason,
	character: Character,
	vehicle: Vehicle
): void {
	if (jobPlan.type !== 'work' || jobPlan.job !== 'vehicleHop') return
	jobPlan.vehicleHopRunEnded = true
	traces.vehicle.warn?.('vehicleHop: service ended during prepare; skipping travel and dock', {
		reason,
		characterUid: character.uid,
	})
}

/**
 * Vehicle-specific work helpers used by `assets/scripts/vehicle.npcs`.
 *
 * The important split is conceptual rather than merely organizational:
 *
 * - `work` owns generic labor domains such as harvest / convey / transform / construction.
 * - `vehicle` owns the operator <-> vehicle seam, line-service lifecycle, and the immediate
 *   inventory actions that happen while driving.
 *
 * The NPC scripts remain tiny and declarative; these methods document the runtime transitions that
 * happen around a vehicle job so the behavior can be understood without reopening the planner.
 */
class VehicleFunctions {
	declare [subject]: Character

	/**
	 * Returns the effective position of the vehicle referenced by the job plan.
	 * Use before vehicleApproachStep to walk to the exact vehicle position.
	 */
	@contract('WorkPlan')
	vehicleEffectivePosition(jobPlan: WorkPlan): { q: number; r: number } | undefined {
		const character = this[subject] as Character
		if (jobPlan.type !== 'work' || !('vehicle' in jobPlan)) return undefined
		const vehicle = jobPlan.vehicle!
		return vehicle.effectivePosition as { q: number; r: number } | undefined
	}

	/**
	 * Board the vehicle referenced by the job plan.
	 * Requires the character to be at the vehicle position (completed walk steps).
	 *
	 * By the time this runs the planner has already selected the vehicle job. For fresh line service,
	 * the service is attached here, after the character has reached the vehicle but before
	 * `character.operates` can satisfy its service-backed invariant.
	 *
	 * `vehicleOffload` reuses the same boarding primitive before continuing with the pickup/drop flow.
	 */
	@contract('WorkPlan')
	vehicleApproachStep(jobPlan: WorkPlan) {
		const character = this[subject] as Character
		if (jobPlan.type !== 'work') return
		if (
			jobPlan.job !== 'vehicleOffload' &&
			!(jobPlan.job === 'vehicleHop' && jobPlan.approachPath && jobPlan.approachPath.length > 0)
		)
			return
		const vehicle = jobPlan.vehicle
		assert(vehicle, 'vehicleApproach: vehicle missing')
		if (vehicle.operator && vehicle.operator.uid !== character.uid) {
			jobPlan.vehicleApproachAborted = true
			traces.vehicle.warn?.('vehicleApproach: stale plan reached already-operated vehicle', {
				characterUid: character.uid,
				operatorUid: vehicle.operator.uid,
			})
			return
		}
		if (jobPlan.job === 'vehicleHop' && jobPlan.needsBeginService && !vehicle.service) {
			assert(
				ensureVehicleServiceStarted(vehicle, character, character.game, character, {
					lineId: jobPlan.lineId,
					stopId: jobPlan.stopId,
					line: jobPlan.line,
					stop: jobPlan.stop,
				}),
				'vehicleApproach: could not start pending line service'
			)
		}
		if (!character.driving) {
			const ct = (character as any)._tile
			const vp = vehicle.effectivePosition
			traces.vehicle.log?.('vehicleJob.approach.preOnboard', {
				characterUid: character.uid,
				tileKey: ct ? axial.key(axial.round(toAxialCoord(ct.position)!)) : undefined,
				vehicleKey: axial.key(axial.round(toAxialCoord(vp)!)),
				footKey: axial.key(axial.round(toAxialCoord(character.position)!)),
			})
			character.operates = vehicle
			character.onboard()
		}
		traces.vehicle.log?.('vehicleJob.approach.onboard', {
			characterUid: character.uid,
		})
		assertDrivingVehicleSeam(character)
		assertVehicleOperationConsistency(vehicle, character)
		traceVehicleStockWithoutService(vehicle)
	}

	/**
	 * Lazily binds the concrete loose-good pickup plan for `vehicleOffload`.
	 *
	 * The planner only decides which loose good and target tile should be cleaned up; the exact
	 * pickup primitive is derived here once the operator is already driving the chosen vehicle.
	 */
	@contract('WorkPlan')
	ensureVehicleOffloadPickupPlan(jobPlan: WorkPlan) {
		const character = this[subject] as Character
		if (jobPlan.type !== 'work' || jobPlan.job !== 'vehicleOffload') return
		if (jobPlan.maintenanceKind !== 'loadFromBurden') return
		assert(character.driving, 'vehicleOffload pickup requires active transport')
		const vehicle = character.operates
		assert(vehicle, 'vehicleOffload pickup: not operating a vehicle')
		const svc = vehicle.service
		assert(
			isVehicleMaintenanceService(svc) && svc.kind === 'loadFromBurden',
			'vehicleOffload pickup: vehicle.service must be a loadFromBurden maintenance run'
		)
		if (jobPlan.offloadPickupPlan) return
		if (svc.offloadPickupPlan) {
			jobPlan.offloadPickupPlan = svc.offloadPickupPlan
			return
		}
		if (!svc.looseGood.available || svc.looseGood.isRemoved) {
			jobPlan.vehicleApproachAborted = true
			traces.vehicle.log?.('vehicleOffload pickup: stale loose good before binding pickup plan', {
				characterUid: character.uid,
				goodType: svc.looseGood.goodType,
				available: svc.looseGood.available,
				removed: svc.looseGood.isRemoved,
			})
			vehicle.endService()
			return
		}
		const pickupTile = character.game.hex.getTile(svc.targetCoord)
		assert(
			pickupTile && 'availableGoods' in pickupTile,
			'vehicleOffload pickup target must be a tile with loose goods'
		)
		let pickupPlan
		try {
			pickupPlan = character.scriptsContext.inventory.planGrabSpecificLoose(
				svc.looseGood,
				pickupTile
			)
		} catch (error) {
			jobPlan.vehicleApproachAborted = true
			traces.vehicle.log?.('vehicleOffload pickup: stale loose good while binding pickup plan', {
				characterUid: character.uid,
				goodType: svc.looseGood.goodType,
				error: error instanceof Error ? error.message : String(error),
			})
			vehicle.endService()
			return
		}
		assert(pickupPlan.type === 'pickup', 'vehicleOffload engagement must bind to a pickup plan')
		svc.offloadPickupPlan = pickupPlan
		jobPlan.offloadPickupPlan = pickupPlan
	}

	/**
	 * Attaches a served freight line to the currently operated vehicle.
	 *
	 * `vehicleBeginService` is the seam between "claimed wheelbarrow" and "line freight run":
	 * after this step, `vehicle.service` exists, the service operator must match the driving
	 * character, and downstream `vehicleHop` becomes the main movement job for the run.
	 */
	@contract('WorkPlan')
	vehicleBeginServiceStep(jobPlan: WorkPlan) {
		const character = this[subject] as Character
		if (jobPlan.type !== 'work' || jobPlan.job !== 'vehicleHop' || !jobPlan.needsBeginService)
			return
		const vehicle = jobPlan.vehicle
		assert(vehicle, 'vehicleBeginService: vehicle missing')
		assert(character.operates?.uid === vehicle.uid, 'vehicleBeginService: wrong operated vehicle')
		assert(character.driving, 'vehicleBeginService: not driving')
		assert(jobPlan.line && jobPlan.stop, 'vehicleBeginService: missing line/stop')
		assert(
			ensureVehicleServiceStarted(vehicle, character, character.game, character, {
				lineId: jobPlan.lineId,
				stopId: jobPlan.stopId,
				line: jobPlan.line,
				stop: jobPlan.stop,
			}),
			'vehicleBeginService: could not start service'
		)
		assertVehicleOperationConsistency(vehicle, character)
		assert(vehicle.service, 'vehicleBeginService: missing service')
		traces.vehicle.log?.('vehicleJob.beginService', {
			characterUid: character.uid,
			lineId: jobPlan.lineId,
			stopId: jobPlan.stopId,
		})
		return new DurationStep(character.freightTransferTime * 0.25, 'work', 'vehicleBeginService')
	}

	/**
	 * Revalidates hop preconditions just before travel.
	 *
	 * This is where "what stop are we really headed to?" gets normalized:
	 * a fully exhausted gather zone may auto-advance to the next stop, and an anchor stop may finish
	 * immediately once dock ads + convey have drained. The script can then simply walk the supplied
	 * path and dock, without duplicating all of those completion checks.
	 *
	 * If advancing past a completed **last** zone stop or a drained anchor ends the run
	 * (`vehicle.endService()`), sets `jobPlan.vehicleHopRunEnded` and returns so `vehicle.npcs` can
	 * skip walk + {@link VehicleFunctions.vehicleHopDockStep} (no `vehicle.service` anymore).
	 */
	@contract('WorkPlan')
	vehicleHopPrepare(jobPlan: WorkPlan) {
		const character = this[subject] as Character
		if (jobPlan.type !== 'work' || jobPlan.job !== 'vehicleHop') return
		const hopPlan = jobPlan as WorkPlan & { vehicleHopReplanRequired?: boolean }
		jobPlan.vehicleHopAnchorDockDisembarked = false
		hopPlan.vehicleHopReplanRequired = false
		const vehicle = jobPlan.vehicle
		assert(vehicle, 'vehicleHop: vehicle missing')
		assert(character.operates?.uid === vehicle.uid, 'vehicleHop: wrong operated vehicle')
		assert(character.driving, 'vehicleHop: not driving')
		jobPlan.vehicleHopStopHandled = false
		vehicleTraceAssert(
			isVehicleLineService(vehicle.service),
			'vehicleHop requires active line service (run vehicleBeginService first)'
		)
		assertVehicleOperationConsistency(vehicle, character)
		maybeAdvanceVehiclePastCompletedZoneStop(character.game, vehicle, character)
		if (!isVehicleLineService(vehicle.service)) {
			markVehicleHopRunEndedBeforeDock(jobPlan, 'zone-complete-ended-run', character, vehicle)
			return
		}
		if (vehicle.isDocked) {
			maybeAdvanceVehicleFromCompletedAnchorStop(character.game, vehicle, character)
			if (!isVehicleLineService(vehicle.service)) {
				markVehicleHopRunEndedBeforeDock(
					jobPlan,
					'anchor-freight-drained-ended-run',
					character,
					vehicle
				)
				return
			}
		}
		if (vehicle.service.line !== jobPlan.line || vehicle.service.stop !== jobPlan.stop) {
			hopPlan.vehicleHopReplanRequired = true
			return
		}
		refreshAnchorHopPathToLiveDock(character, vehicle, jobPlan)
	}

	/**
	 * Applies the post-travel dock state for the current stop.
	 *
	 * Anchor stops mark the vehicle as docked so dock advertisements / convey can interact with the
	 * onboard storage. Zone stops deliberately clear docking because loading/unloading happens at the
	 * zone target itself, not through a bay endpoint.
	 *
	 * When line service ended during {@link VehicleFunctions.vehicleHopPrepare}, the NPC script must
	 * not reach here; if it does (e.g. service cleared mid-walk), warn and no-op instead of asserting.
	 */
	@contract('WorkPlan')
	vehicleHopDockStep(jobPlan: WorkPlan) {
		const character = this[subject] as Character
		if (jobPlan.type !== 'work' || jobPlan.job !== 'vehicleHop') return
		const hopPlan = jobPlan as WorkPlan & { vehicleHopReplanRequired?: boolean }
		const wasReplanRequired = hopPlan.vehicleHopReplanRequired
		hopPlan.vehicleHopReplanRequired = false
		traces.vehicle.log?.('vehicleHopDockStep: entry', {
			characterUid: character.uid,
			dockEnter: (jobPlan as any).dockEnter,
			wasReplanRequired,
			vehicleHopStopHandled: (jobPlan as any).vehicleHopStopHandled,
		})
		const vehicle = jobPlan.vehicle
		assert(vehicle, 'vehicleHopDockStep: vehicle missing')
		if (!isVehicleLineService(vehicle.service)) {
			traces.vehicle.warn?.('vehicleHopDockStep: no active line service (unexpected tail)', {
				characterUid: character.uid,
				vehicleHopRunEnded: jobPlan.vehicleHopRunEnded,
			})
			return
		}
		assert(character.operates?.uid === vehicle.uid, 'vehicleHopDockStep: wrong operated vehicle')
		const stop = vehicle.service.stop
		assert(stop, 'vehicleHopDockStep: missing stop')
		if (vehicle.service.line.id !== jobPlan.lineId || stop.id !== jobPlan.stopId) {
			traces.vehicle.warn?.(
				'vehicleHopDockStep: live service drifted from planned stop; skipping dock',
				{
					characterUid: character.uid,
					plannedLineId: jobPlan.lineId,
					plannedStopId: jobPlan.stopId,
					actualLineId: vehicle.service.line.id,
					actualStopId: stop.id,
				}
			)
			return
		}
		if ('anchor' in stop) {
			jobPlan.vehicleHopAnchorDockDisembarked = true
			jobPlan.vehicleHopStopHandled = true
			if (!vehicleCanDockAtCurrentPosition(vehicle)) {
				traces.vehicle.log?.('vehicleHopDockStep: cannot dock, attempting recovery', {
					characterUid: character.uid,
					lineId: vehicle.service.line.id,
					stopId: stop.id,
					vehicleCoord: vehicle.position ? toAxialCoord(vehicle.position) : undefined,
					dockCoord: vehicle.dockTile ? toAxialCoord(vehicle.dockTile.position) : undefined,
				})
				const recoveryStep = moveTowardLiveDockStep(character, vehicle, jobPlan)
				if (recoveryStep) {
					traces.vehicle.log?.('vehicleHopDockStep: returning recovery step', {
						characterUid: character.uid,
						stepType: 'MoveToStep',
					})
					return recoveryStep
				}
				;(jobPlan as WorkPlan & { vehicleHopReplanRequired?: boolean }).vehicleHopReplanRequired =
					true
				jobPlan.vehicleHopAnchorDockDisembarked = false
				jobPlan.vehicleHopStopHandled = false
				traces.vehicle.warn?.('vehicleHopDockStep: vehicle not at dock; replan required', {
					characterUid: character.uid,
					lineId: vehicle.service.line.id,
					stopId: stop.id,
					vehicleCoord: vehicle.position ? toAxialCoord(vehicle.position) : undefined,
					dockCoord: vehicle.dockTile ? toAxialCoord(vehicle.dockTile.position) : undefined,
				})
				traces.vehicle.log?.('vehicleHopDockStep: returning undefined for replan', {
					characterUid: character.uid,
					vehicleHopReplanRequired: true,
				})
				return
			}
			vehicle.dock()
			assertDockedSemantics(vehicle)
			traces.vehicle.log?.('vehicleJob.hop.dock', {
				characterUid: character.uid,
				lineId: vehicle.service?.line.id,
				stopId: vehicle.service?.stop.id,
			})
			assertVehicleOperationConsistency(vehicle, character)
			const dockStep = new DurationStep(
				character.freightTransferTime * 0.25,
				'work',
				'vehicleHop.dock'
			).onFulfilled(() => {
				disembarkOperatorLeavingDockedVehicleInService(character, vehicle)
				assertVehicleOperationConsistency(vehicle, character)
			})
			traces.vehicle.log?.('vehicleHopDockStep: returning dock DurationStep', {
				characterUid: character.uid,
			})
			return dockStep
		} else {
			jobPlan.vehicleHopAnchorDockDisembarked = false
			jobPlan.vehicleHopStopHandled = false
			vehicle.undock()
			if ('trade' in stop) {
				jobPlan.vehicleHopStopHandled = true
				if (character.driving) character.stepOffVehicleKeepingControl()
				executeNpcTradeStopAndAdvance(character.game, vehicle, character)
				if (character.operates?.uid === vehicle.uid && isVehicleLineService(vehicle.service)) {
					character.disengageVehicleKeepingService()
				}
			}
			traces.vehicle.log?.('vehicleJob.hop.zoneReach', {
				characterUid: character.uid,
				lineId: vehicle.service?.line.id,
				stopId: vehicle.service?.stop.id,
			})
		}
		assertVehicleOperationConsistency(vehicle, character)
		const zoneReachStep = new DurationStep(
			character.freightTransferTime * 0.25,
			'work',
			'vehicleHop.zoneReach'
		)
		traces.vehicle.log?.('vehicleHopDockStep: returning zoneReach DurationStep', {
			characterUid: character.uid,
		})
		return zoneReachStep
	}

	@contract('WorkPlan')
	vehicleStepOffKeepingControl(jobPlan: WorkPlan) {
		const character = this[subject] as Character
		if (jobPlan.type !== 'work') return
		if (
			jobPlan.job !== 'vehicleHop' &&
			jobPlan.job !== 'zoneBrowse' &&
			jobPlan.job !== 'vehicleOffload'
		)
			return
		const vehicle = jobPlan.vehicle
		assert(vehicle, 'vehicleStepOffKeepingControl: vehicle missing')
		assert(
			character.operates?.uid === vehicle.uid,
			'vehicleStepOffKeepingControl: wrong operated vehicle'
		)
		assert(character.driving, 'vehicleStepOffKeepingControl: not driving')
		character.stepOffVehicleKeepingControl()
		assertVehicleOperationConsistency(vehicle, character)
	}

	@contract('WorkPlan')
	serviceTargetIsBlocking(jobPlan: WorkPlan): boolean {
		return vehicleServiceTargetIsBlocking(this[subject] as Character, jobPlan)
	}

	@contract()
	pathToOperatedVehicle(): AxialCoord[] {
		const character = this[subject] as Character
		const vehicle = character.operates
		if (!vehicle) return []
		const vehiclePosition = toAxialCoord(vehicle.effectivePosition)
		if (!vehiclePosition) return []
		if (positionRoughlyEquals(toAxialCoord(character.position), vehiclePosition)) return []
		return [vehiclePosition]
	}

	@contract('WorkPlan')
	vehicleBoardLinkedVehicle(jobPlan: WorkPlan) {
		const character = this[subject] as Character
		if (jobPlan.type !== 'work') return
		if (
			jobPlan.job !== 'vehicleHop' &&
			jobPlan.job !== 'zoneBrowse' &&
			jobPlan.job !== 'vehicleOffload'
		)
			return
		const vehicle = jobPlan.vehicle
		assert(vehicle, 'vehicleBoardLinkedVehicle: vehicle missing')
		if (character.operates?.uid !== vehicle.uid) return
		if (character.driving) return
		character.boardLinkedVehicle()
		assertVehicleOperationConsistency(vehicle, character)
	}

	@contract('WorkPlan')
	vehicleDisengageKeepingService(jobPlan: WorkPlan) {
		const character = this[subject] as Character
		if (jobPlan.type !== 'work') return
		if (jobPlan.job !== 'vehicleHop' && jobPlan.job !== 'zoneBrowse') return
		const vehicle = jobPlan.vehicle
		assert(vehicle, 'vehicleDisengageKeepingService: vehicle missing')
		if (character.operates?.uid !== vehicle.uid) {
			traces.vehicle.log?.('vehicleDisengageKeepingService: already released', {
				characterUid: character.uid,
				operatesUid: character.operates?.uid,
				serviceKind: isVehicleLineService(vehicle.service)
					? 'line'
					: isVehicleMaintenanceService(vehicle.service)
						? vehicle.service.kind
						: undefined,
			})
			return
		}
		if (!isVehicleLineService(vehicle.service)) {
			traces.vehicle.log?.('vehicleDisengageKeepingService: service already ended', {
				characterUid: character.uid,
			})
			return
		}
		assertVehicleOperationConsistency(vehicle, character)
		character.disengageVehicleKeepingService()
		assertVehicleOperationConsistency(vehicle, character)
	}

	@contract('WorkPlan')
	vehicleLoadTransferStep(jobPlan: WorkPlan) {
		const character = this[subject] as Character
		if (jobPlan.type !== 'work') return
		if (jobPlan.job === 'vehicleOffload') {
			assert(
				jobPlan.maintenanceKind === 'loadFromBurden',
				'vehicleLoadTransferStep: expected loadFromBurden maintenance'
			)
			const vehicle = jobPlan.vehicle
			assert(vehicle, 'vehicleLoadTransferStep: vehicle missing')
			assert(
				character.operates?.uid === vehicle.uid,
				'vehicleLoadTransferStep: wrong operated vehicle'
			)
			assert(jobPlan.offloadPickupPlan, 'vehicleLoadTransferStep: missing offload pickup plan')
			traces.vehicle.log?.('vehicleJob.load', {
				characterUid: character.uid,
				goodType: jobPlan.offloadPickupPlan.goodType,
			})
			const result = character.scriptsContext.inventory.effectuate(jobPlan.offloadPickupPlan)
			if (!jobPlan.vehicleMaintenanceCompletionDeferred) {
				result.onFulfilled(() => {
					VehicleFunctions.prototype.completeVehicleMaintenanceService.call(this, jobPlan)
				})
			}
			assertVehicleOperationConsistency(vehicle, character)
			return result
		}
		if (jobPlan.job === 'loadOntoVehicle') {
			return VehicleFunctions.prototype.loadOntoVehicleStep.call(this, jobPlan)
		}
		if (jobPlan.job !== 'vehicleHop' && jobPlan.job !== 'zoneBrowse') return
		if (jobPlan.zoneBrowseAction !== 'load') return
		assert(jobPlan.goodType, 'vehicleZoneBrowseTransferStep: missing goodType')
		return VehicleFunctions.prototype.loadOntoVehicleStep.call(this, {
			...jobPlan,
			job: 'loadOntoVehicle',
			goodType: jobPlan.goodType,
		})
	}

	@contract('WorkPlan')
	vehicleUnloadTransferStep(jobPlan: WorkPlan) {
		const character = this[subject] as Character
		if (jobPlan.type !== 'work') return
		if (jobPlan.job === 'vehicleOffload') {
			assert(
				jobPlan.maintenanceKind === 'loadFromBurden' || jobPlan.maintenanceKind === 'unloadToTile',
				'vehicleUnloadTransferStep: expected unload-capable maintenance'
			)
			const result = character.scriptsContext.inventory.offloadDropBuffer()
			if (!jobPlan.vehicleMaintenanceCompletionDeferred) {
				result.onFulfilled(() => {
					VehicleFunctions.prototype.completeVehicleMaintenanceService.call(this, jobPlan)
				})
			}
			return result
		}
		if (jobPlan.job === 'provideFromVehicle') {
			return VehicleFunctions.prototype.provideFromVehicleStep.call(this, jobPlan)
		}
		if (jobPlan.job !== 'vehicleHop' && jobPlan.job !== 'zoneBrowse') return
		if (jobPlan.zoneBrowseAction !== 'provide') return
		assert(jobPlan.goodType, 'vehicleZoneBrowseTransferStep: missing goodType')
		return VehicleFunctions.prototype.provideFromVehicleStep.call(this, {
			...jobPlan,
			job: 'provideFromVehicle',
			goodType: jobPlan.goodType,
			quantity: jobPlan.quantity ?? 1,
		})
	}

	@contract('WorkPlan')
	vehicleZoneBrowseTransferStep(jobPlan: WorkPlan) {
		if (jobPlan.type !== 'work') return
		if (
			jobPlan.job === 'provideFromVehicle' ||
			('zoneBrowseAction' in jobPlan && jobPlan.zoneBrowseAction === 'provide')
		) {
			return VehicleFunctions.prototype.vehicleUnloadTransferStep.call(this, jobPlan)
		}
		return VehicleFunctions.prototype.vehicleLoadTransferStep.call(this, jobPlan)
	}

	/**
	 * Picks loose goods up from the current zone stop tile into the active vehicle storage.
	 *
	 * This is intentionally the *zone* loading primitive; bay-anchor loading is handled by dock
	 * advertisements and hive convey instead of a driver micro-job.
	 */
	@contract('WorkPlan')
	loadOntoVehicleStep(jobPlan: WorkPlan) {
		const character = this[subject] as Character
		if (jobPlan.type !== 'work' || jobPlan.job !== 'loadOntoVehicle') return
		const vehicle = jobPlan.vehicle
		assert(vehicle, 'loadOntoVehicle: vehicle missing')
		assert(character.operates?.uid === vehicle.uid, 'loadOntoVehicle: wrong operated vehicle')
		traces.vehicle.log?.('vehicleJob.load', {
			characterUid: character.uid,
			goodType: jobPlan.goodType,
		})
		const action = character.scriptsContext.inventory.planGrabLoose(
			jobPlan.goodType,
			character.tile
		)
		const result = character.scriptsContext.inventory.effectuate(action)
		// `EffectuateResult.finished` runs only on successful completion, not on cancel.
		result.onFulfilled(() => {
			maybeAdvanceVehiclePastCompletedZoneStop(character.game, vehicle, character)
		})
		assertVehicleOperationConsistency(vehicle, character)
		return result
	}

	/**
	 * Legacy/manual unload primitive from vehicle storage onto the current tile storage.
	 *
	 * Bay-anchor unload is no longer supposed to be discovered through the planner because docked
	 * vehicle endpoints now advertise directly into hive convey. This helper remains useful for tests
	 * and any manual/diagnostic calls that still exercise the old primitive.
	 */
	@contract('WorkPlan')
	unloadFromVehicleStep(jobPlan: WorkPlan) {
		const character = this[subject] as Character
		if (jobPlan.type !== 'work' || jobPlan.job !== 'unloadFromVehicle') return
		const vehicle = jobPlan.vehicle
		assert(vehicle, 'unloadFromVehicle: vehicle missing')
		assert(character.operates?.uid === vehicle.uid, 'unloadFromVehicle: wrong operated vehicle')
		assert(character.driving, 'unloadFromVehicle: not driving')
		traces.vehicle.log?.('vehicleJob.unload', {
			characterUid: character.uid,
			goodType: jobPlan.goodType,
			quantity: jobPlan.quantity,
		})
		const drop = character.scriptsContext.inventory.planDropStored(
			{ [jobPlan.goodType]: jobPlan.quantity },
			character.tile
		)
		if (drop.type === 'idle') return
		const result = character.scriptsContext.inventory.effectuate(drop)
		assertVehicleOperationConsistency(vehicle, character)
		return result
	}

	/**
	 * Delivers carried goods from the active vehicle into a standalone sink on the current tile.
	 *
	 * This intentionally remains valid even when the vehicle is not attached to an active line
	 * service, so a preloaded or idle wheelbarrow can still feed construction as an escape hatch.
	 */
	@contract('WorkPlan')
	provideFromVehicleStep(jobPlan: WorkPlan) {
		const character = this[subject] as Character
		if (jobPlan.type !== 'work' || jobPlan.job !== 'provideFromVehicle') return
		const vehicle = jobPlan.vehicle
		assert(vehicle, 'provideFromVehicle: vehicle missing')
		assert(character.operates?.uid === vehicle.uid, 'provideFromVehicle: wrong operated vehicle')
		traces.vehicle.log?.('vehicleJob.provide', {
			characterUid: character.uid,
			goodType: jobPlan.goodType,
			quantity: jobPlan.quantity,
		})
		const drop = character.scriptsContext.inventory.planDropStored(
			{ [jobPlan.goodType]: jobPlan.quantity },
			character.tile
		)
		if (drop.type === 'idle') return
		const result = character.scriptsContext.inventory.effectuate(drop)
		// `EffectuateResult.finished` runs only on successful completion, not on cancel.
		result.onFulfilled(() => {
			maybeAdvanceVehiclePastCompletedZoneStop(character.game, vehicle, character)
		})
		traceVehicleStockWithoutService(vehicle)
		assertVehicleOperationConsistency(vehicle, character)
		return result
	}

	/**
	 * Reads the maintenance sub-kind from `vehicle.service` (the source of truth) when the operator
	 * is mid-`vehicleOffload`. Returns `undefined` when not on a maintenance run, so scripts can
	 * branch defensively without re-deriving the discriminator from the (hint-only) job plan.
	 */
	@contract()
	maintenanceKind(): 'loadFromBurden' | 'unloadToTile' | 'park' | undefined {
		const character = this[subject] as Character
		const vehicle = character.operates
		if (!vehicle) return undefined
		const svc = vehicle.service
		if (!isVehicleMaintenanceService(svc)) return undefined
		return svc.kind
	}

	/**
	 * Marks a maintenance `vehicleOffload` run as finished. Unlike generic WorkPlan cleanup, this is
	 * allowed to end the vehicle service: the scripted maintenance objective reached its terminal step.
	 */
	@contract('WorkPlan')
	completeVehicleMaintenanceService(jobPlan: WorkPlan) {
		const character = this[subject] as Character
		if (jobPlan.type !== 'work' || jobPlan.job !== 'vehicleOffload') return
		const vehicle = jobPlan.vehicle
		assert(vehicle, 'completeVehicleMaintenanceService: vehicle missing')
		assert(
			character.operates?.uid === vehicle.uid,
			'completeVehicleMaintenanceService: wrong operated vehicle'
		)
		const svc = vehicle.service
		assert(
			isVehicleMaintenanceService(svc),
			'completeVehicleMaintenanceService: vehicle.service must be maintenance'
		)
		assert(
			svc.kind === jobPlan.maintenanceKind,
			'completeVehicleMaintenanceService: live service kind drifted from job plan'
		)
		traces.vehicle.log?.('vehicleJob.maintenance.complete', {
			characterUid: character.uid,
			maintenanceKind: svc.kind,
		})
		if (svc.kind === 'loadFromBurden') {
			const chained = beginLoadedVehicleUnloadMaintenance(character.game, vehicle, character)
			if (chained) {
				character.disengageVehicleKeepingService()
				return
			}
		}
		offboardOperatorAfterFreightWorkComplete(character)
	}

	/**
	 * Abort one stale maintenance run without turning a transient path miss into a hard script error.
	 * The next planner pass will rediscover fresh maintenance candidates from current board state.
	 */
	@contract('WorkPlan', 'string?')
	abandonVehicleMaintenanceService(jobPlan: WorkPlan, reason: string = 'unreachable-target') {
		const character = this[subject] as Character
		if (jobPlan.type !== 'work' || jobPlan.job !== 'vehicleOffload') return
		const vehicle = jobPlan.vehicle
		assert(vehicle, 'abandonVehicleMaintenanceService: vehicle missing')
		if (character.operates?.uid !== vehicle.uid) return
		const svc = vehicle.service
		if (!isVehicleMaintenanceService(svc)) return
		traces.vehicle.warn?.('vehicleJob.maintenance.abandon', {
			characterUid: character.uid,
			maintenanceKind: svc.kind,
			targetCoord: svc.targetCoord,
			reason,
		})
		offboardOperatorAfterFreightWorkComplete(character)
	}

	/**
	 * Ends a `park` maintenance run after the wheelbarrow has reached its parking tile: drops
	 * `vehicle.service`, releases the operator binding, and offboards the driver. Symmetric to
	 * {@link detachVehicleServiceIfStorageEmpty} for the empty-storage path, but unconditional —
	 * `park` runs always end on arrival regardless of stock (which is empty by precondition).
	 */
	@contract()
	endParkingService() {
		const character = this[subject] as Character
		const vehicle = character.operates
		assert(vehicle, 'endParkingService: not operating a vehicle')
		const svc = vehicle.service
		assert(
			isVehicleMaintenanceService(svc) && svc.kind === 'park',
			'endParkingService: vehicle.service must be a park maintenance run'
		)
		traces.vehicle.log?.('vehicleJob.park.end', {
			characterUid: character.uid,
		})
		this.completeVehicleMaintenanceService({
			type: 'work',
			job: 'vehicleOffload',
			vehicle,
			target: vehicle,
			path: [],
			urgency: 0,
			fatigue: 0,
			maintenanceKind: 'park',
			targetCoord: svc.targetCoord,
		})
	}
}

export { VehicleFunctions }
