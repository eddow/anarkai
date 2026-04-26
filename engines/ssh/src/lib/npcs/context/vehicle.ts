import { assert, traces } from 'ssh/debug'
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
	maybeAdvanceVehicleFromCompletedAnchorStop,
	maybeAdvanceVehiclePastCompletedZoneStop,
	offboardOperatorAfterFreightWorkComplete,
} from 'ssh/freight/vehicle-run'
import type { Character } from 'ssh/population/character'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import { isVehicleLineService, isVehicleMaintenanceService } from 'ssh/population/vehicle/vehicle'
import { contract } from 'ssh/types'
import { subject } from '../scripts'
import { DurationStep } from '../steps'
import type { WorkPlan } from '.'

type VehicleHopRunEndedReason = 'zone-complete-ended-run' | 'anchor-freight-drained-ended-run'

function markVehicleHopRunEndedBeforeDock(
	jobPlan: WorkPlan,
	reason: VehicleHopRunEndedReason,
	character: Character,
	vehicle: VehicleEntity
): void {
	if (jobPlan.type !== 'work' || jobPlan.job !== 'vehicleHop') return
	jobPlan.vehicleHopRunEnded = true
	traces.vehicle.warn?.('vehicleHop: service ended during prepare; skipping travel and dock', {
		reason,
		characterUid: character.uid,
		vehicleUid: vehicle.uid,
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
	 * Finalizes a planned approach to a vehicle.
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
		const vehicle = character.game.vehicles.vehicle(jobPlan.vehicleUid)
		assert(vehicle, 'vehicleApproach: vehicle missing')
		if (jobPlan.job === 'vehicleHop' && jobPlan.needsBeginService && !vehicle.service) {
			assert(
				ensureVehicleServiceStarted(vehicle, character, character.game, character, {
					lineId: jobPlan.lineId,
					stopId: jobPlan.stopId,
				}),
				'vehicleApproach: could not start pending line service'
			)
		}
		if (!character.driving) {
			character.operates = vehicle
			character.onboard()
		}
		traces.vehicle.log?.('vehicleJob.approach.onboard', {
			characterUid: character.uid,
			vehicleUid: vehicle.uid,
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
		const pickupTile = character.game.hex.getTile(svc.targetCoord)
		assert(
			pickupTile && 'availableGoods' in pickupTile,
			'vehicleOffload pickup target must be a tile with loose goods'
		)
		const pickupPlan = character.scriptsContext.inventory.planGrabSpecificLoose(
			svc.looseGood,
			pickupTile
		)
		assert(pickupPlan.type === 'pickup', 'vehicleOffload engagement must bind to a pickup plan')
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
		const vehicle = character.game.vehicles.vehicle(jobPlan.vehicleUid)
		assert(vehicle, 'vehicleBeginService: vehicle missing')
		assert(character.operates?.uid === vehicle.uid, 'vehicleBeginService: wrong operated vehicle')
		assert(character.driving, 'vehicleBeginService: not driving')
		assert('lineId' in jobPlan && 'stopId' in jobPlan, 'vehicleBeginService: missing line/stop ids')
		assert(
			ensureVehicleServiceStarted(vehicle, character, character.game, character, {
				lineId: jobPlan.lineId,
				stopId: jobPlan.stopId,
			}),
			'vehicleBeginService: could not start service'
		)
		assertVehicleOperationConsistency(vehicle, character)
		maybeAdvanceVehiclePastCompletedZoneStop(character.game, vehicle, character)
		assert(vehicle.service, 'vehicleBeginService: missing service')
		traces.vehicle.log?.('vehicleJob.beginService', {
			characterUid: character.uid,
			vehicleUid: vehicle.uid,
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
		const vehicle = character.game.vehicles.vehicle(jobPlan.vehicleUid)
		assert(vehicle, 'vehicleHop: vehicle missing')
		assert(character.operates?.uid === vehicle.uid, 'vehicleHop: wrong operated vehicle')
		assert(character.driving, 'vehicleHop: not driving')
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
		if (vehicle.service.line.id !== jobPlan.lineId || vehicle.service.stop.id !== jobPlan.stopId) {
			hopPlan.vehicleHopReplanRequired = true
		}
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
		const vehicle = character.game.vehicles.vehicle(jobPlan.vehicleUid)
		assert(vehicle, 'vehicleHopDockStep: vehicle missing')
		if (!isVehicleLineService(vehicle.service)) {
			traces.vehicle.warn?.('vehicleHopDockStep: no active line service (unexpected tail)', {
				characterUid: character.uid,
				vehicleUid: vehicle.uid,
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
					vehicleUid: vehicle.uid,
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
			vehicle.dock()
			assertDockedSemantics(vehicle)
			traces.vehicle.log?.('vehicleJob.hop.dock', {
				characterUid: character.uid,
				vehicleUid: vehicle.uid,
				lineId: vehicle.service?.line.id,
				stopId: vehicle.service?.stop.id,
			})
			assertVehicleOperationConsistency(vehicle, character)
			return new DurationStep(
				character.freightTransferTime * 0.25,
				'work',
				'vehicleHop.dock'
			).finished(() => {
				disembarkOperatorLeavingDockedVehicleInService(character, vehicle)
				assertVehicleOperationConsistency(vehicle, character)
			})
		} else {
			jobPlan.vehicleHopAnchorDockDisembarked = false
			vehicle.undock()
			traces.vehicle.log?.('vehicleJob.hop.zoneReach', {
				characterUid: character.uid,
				vehicleUid: vehicle.uid,
				lineId: vehicle.service?.line.id,
				stopId: vehicle.service?.stop.id,
			})
		}
		assertVehicleOperationConsistency(vehicle, character)
		return new DurationStep(character.freightTransferTime * 0.25, 'work', 'vehicleHop.zoneReach')
	}

	@contract('WorkPlan')
	vehicleStepOffKeepingControl(jobPlan: WorkPlan) {
		const character = this[subject] as Character
		if (jobPlan.type !== 'work') return
		if (jobPlan.job !== 'vehicleHop' && jobPlan.job !== 'zoneBrowse') return
		const vehicle = character.game.vehicles.vehicle(jobPlan.vehicleUid)
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
	vehicleDisengageKeepingService(jobPlan: WorkPlan) {
		const character = this[subject] as Character
		if (jobPlan.type !== 'work') return
		if (jobPlan.job !== 'vehicleHop' && jobPlan.job !== 'zoneBrowse') return
		const vehicle = character.game.vehicles.vehicle(jobPlan.vehicleUid)
		assert(vehicle, 'vehicleDisengageKeepingService: vehicle missing')
		assert(
			character.operates?.uid === vehicle.uid,
			'vehicleDisengageKeepingService: wrong operated vehicle'
		)
		vehicleTraceAssert(
			isVehicleLineService(vehicle.service),
			'vehicleDisengageKeepingService requires line service'
		)
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
			const vehicle = character.game.vehicles.vehicle(jobPlan.vehicleUid)
			assert(vehicle, 'vehicleLoadTransferStep: vehicle missing')
			assert(
				character.operates?.uid === vehicle.uid,
				'vehicleLoadTransferStep: wrong operated vehicle'
			)
			assert(jobPlan.offloadPickupPlan, 'vehicleLoadTransferStep: missing offload pickup plan')
			traces.vehicle.log?.('vehicleJob.load', {
				characterUid: character.uid,
				vehicleUid: vehicle.uid,
				goodType: jobPlan.offloadPickupPlan.goodType,
			})
			const result = character.scriptsContext.inventory.effectuate(jobPlan.offloadPickupPlan)
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
			return character.scriptsContext.inventory.offloadDropBuffer()
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
		const vehicle = character.game.vehicles.vehicle(jobPlan.vehicleUid)
		assert(vehicle, 'loadOntoVehicle: vehicle missing')
		assert(character.operates?.uid === vehicle.uid, 'loadOntoVehicle: wrong operated vehicle')
		traces.vehicle.log?.('vehicleJob.load', {
			characterUid: character.uid,
			vehicleUid: vehicle.uid,
			goodType: jobPlan.goodType,
		})
		const action = character.scriptsContext.inventory.planGrabLoose(
			jobPlan.goodType,
			character.tile
		)
		const result = character.scriptsContext.inventory.effectuate(action)
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
		const vehicle = character.game.vehicles.vehicle(jobPlan.vehicleUid)
		assert(vehicle, 'unloadFromVehicle: vehicle missing')
		assert(character.operates?.uid === vehicle.uid, 'unloadFromVehicle: wrong operated vehicle')
		assert(character.driving, 'unloadFromVehicle: not driving')
		traces.vehicle.log?.('vehicleJob.unload', {
			characterUid: character.uid,
			vehicleUid: vehicle.uid,
			goodType: jobPlan.goodType,
			quantity: jobPlan.quantity,
		})
		const drop = character.scriptsContext.inventory.planDropStored(
			{ [jobPlan.goodType]: jobPlan.quantity },
			character.tile
		)
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
		const vehicle = character.game.vehicles.vehicle(jobPlan.vehicleUid)
		assert(vehicle, 'provideFromVehicle: vehicle missing')
		assert(character.operates?.uid === vehicle.uid, 'provideFromVehicle: wrong operated vehicle')
		traces.vehicle.log?.('vehicleJob.provide', {
			characterUid: character.uid,
			vehicleUid: vehicle.uid,
			goodType: jobPlan.goodType,
			quantity: jobPlan.quantity,
		})
		const drop = character.scriptsContext.inventory.planDropStored(
			{ [jobPlan.goodType]: jobPlan.quantity },
			character.tile
		)
		const result = character.scriptsContext.inventory.effectuate(drop)
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
		const vehicle = character.game.vehicles.vehicle(jobPlan.vehicleUid)
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
			vehicleUid: vehicle.uid,
			maintenanceKind: svc.kind,
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
			vehicleUid: vehicle.uid,
		})
		this.completeVehicleMaintenanceService({
			type: 'work',
			job: 'vehicleOffload',
			vehicleUid: vehicle.uid,
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
