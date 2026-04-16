import { assert, traces } from 'ssh/debug'
import {
	assertDockedSemantics,
	assertDrivingVehicleSeam,
	assertVehicleServiceOperator,
	traceVehicleStockWithoutService,
	vehicleTraceAssert,
} from 'ssh/freight/vehicle-invariants'
import {
	disembarkOperatorLeavingDockedVehicleInService,
	ensureVehicleServiceStarted,
	maybeAdvanceVehicleFromCompletedAnchorStop,
	maybeAdvanceVehiclePastCompletedZoneStop,
} from 'ssh/freight/vehicle-run'
import type { Character } from 'ssh/population/character'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import { isVehicleLineService } from 'ssh/population/vehicle/vehicle'
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
	if (!character.operates) {
		character.position = { ...character.tile.position }
	}
	traces.vehicle?.warn?.('vehicleHop: service ended during prepare; skipping travel and dock', {
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
	 * By the time this runs the planner has already selected the vehicle job and
	 * `plan.begin` has claimed the vehicle through `character.operates`.
	 * This step therefore does not "reserve" the vehicle; it only converts that reservation into the
	 * physical boarded state once the character has actually reached the same hex.
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
		if (!character.driving) {
			character.operates = vehicle
			character.onboard()
		}
		traces.vehicle?.log?.('vehicleJob.approach.onboard', {
			characterUid: character.uid,
			vehicleUid: vehicle.uid,
		})
		assertDrivingVehicleSeam(character)
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
		assert(character.driving, 'vehicleOffload pickup requires active transport')
		assert('targetCoord' in jobPlan, 'vehicleOffload requires targetCoord')
		if (jobPlan.offloadPickupPlan) return
		const pickupTile = character.game.hex.getTile(jobPlan.targetCoord)
		assert(
			pickupTile && 'availableGoods' in pickupTile,
			'vehicleOffload pickup target must be a tile with loose goods'
		)
		const pickupPlan = character.scriptsContext.inventory.planGrabSpecificLoose(
			jobPlan.looseGood,
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
		assertVehicleServiceOperator(vehicle, character)
		maybeAdvanceVehiclePastCompletedZoneStop(character.game, vehicle, character)
		assert(vehicle.service, 'vehicleBeginService: missing service')
		traces.vehicle?.log?.('vehicleJob.beginService', {
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
		jobPlan.vehicleHopAnchorDockDisembarked = false
		const vehicle = character.game.vehicles.vehicle(jobPlan.vehicleUid)
		assert(vehicle, 'vehicleHop: vehicle missing')
		assert(character.operates?.uid === vehicle.uid, 'vehicleHop: wrong operated vehicle')
		assert(character.driving, 'vehicleHop: not driving')
		vehicleTraceAssert(
			isVehicleLineService(vehicle.service),
			'vehicleHop requires active line service (run vehicleBeginService first)'
		)
		assertVehicleServiceOperator(vehicle, character)
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
			traces.vehicle?.warn?.('vehicleHopDockStep: no active line service (unexpected tail)', {
				characterUid: character.uid,
				vehicleUid: vehicle.uid,
				vehicleHopRunEnded: jobPlan.vehicleHopRunEnded,
			})
			return
		}
		assert(character.operates?.uid === vehicle.uid, 'vehicleHopDockStep: wrong operated vehicle')
		const stop = vehicle.service.stop
		assert(stop, 'vehicleHopDockStep: missing stop')
		if ('anchor' in stop) {
			jobPlan.vehicleHopAnchorDockDisembarked = true
			vehicle.dock()
			assertDockedSemantics(vehicle)
			traces.vehicle?.log?.('vehicleJob.hop.dock', {
				characterUid: character.uid,
				vehicleUid: vehicle.uid,
				kind: 'anchor',
				lineId: vehicle.service?.line.id,
				stopId: vehicle.service?.stop.id,
			})
			disembarkOperatorLeavingDockedVehicleInService(character, vehicle)
		} else {
			jobPlan.vehicleHopAnchorDockDisembarked = false
			vehicle.undock()
			traces.vehicle?.log?.('vehicleJob.hop.dock', {
				characterUid: character.uid,
				vehicleUid: vehicle.uid,
				kind: 'zone',
				lineId: vehicle.service?.line.id,
				stopId: vehicle.service?.stop.id,
			})
		}
		return new DurationStep(character.freightTransferTime * 0.25, 'work', 'vehicleHop.dock')
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
		assertVehicleServiceOperator(vehicle, character)
		character.disengageVehicleKeepingService()
	}

	@contract('WorkPlan')
	vehicleZoneBrowseTransferStep(jobPlan: WorkPlan) {
		if (jobPlan.type !== 'work') return
		if (jobPlan.job === 'provideFromVehicle') {
			return this.provideFromVehicleStep(jobPlan)
		}
		if (jobPlan.job === 'loadOntoVehicle') {
			return this.loadOntoVehicleStep(jobPlan)
		}
		if (jobPlan.job !== 'vehicleHop' && jobPlan.job !== 'zoneBrowse') return
		assert(jobPlan.goodType, 'vehicleZoneBrowseTransferStep: missing goodType')
		if (jobPlan.zoneBrowseAction === 'provide') {
			return this.provideFromVehicleStep({
				...jobPlan,
				job: 'provideFromVehicle',
				goodType: jobPlan.goodType,
				quantity: jobPlan.quantity ?? 1,
			})
		}
		return this.loadOntoVehicleStep({
			...jobPlan,
			job: 'loadOntoVehicle',
			goodType: jobPlan.goodType,
		})
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
		traces.vehicle?.log?.('vehicleJob.load', {
			characterUid: character.uid,
			vehicleUid: vehicle.uid,
			goodType: jobPlan.goodType,
		})
		const action = character.scriptsContext.inventory.planGrabLoose(
			jobPlan.goodType,
			character.tile
		)
		return character.scriptsContext.inventory.effectuate(action)
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
		traces.vehicle?.log?.('vehicleJob.unload', {
			characterUid: character.uid,
			vehicleUid: vehicle.uid,
			goodType: jobPlan.goodType,
			quantity: jobPlan.quantity,
		})
		const drop = character.scriptsContext.inventory.planDropStored(
			{ [jobPlan.goodType]: jobPlan.quantity },
			character.tile
		)
		return character.scriptsContext.inventory.effectuate(drop)
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
		traces.vehicle?.log?.('vehicleJob.provide', {
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
		return result
	}
}

export { VehicleFunctions }
