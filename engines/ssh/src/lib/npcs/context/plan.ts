/** Plan begin/conclude for transfers; reservations use {@link Character.carry} (vehicle storage when driving). */
import { type HexBoard, isTileCoord } from 'ssh/board'
import type { Alveolus } from 'ssh/board/content/alveolus'
import { assert } from 'ssh/debug'
import { assertVehicleOperationConsistency } from 'ssh/freight/vehicle-invariants'
import { releaseVehicleFreightWorkOnPlanInterrupt } from 'ssh/freight/vehicle-run'
import { allocateVehicleServiceForJob } from 'ssh/freight/vehicle-work'
import type { Character } from 'ssh/population/character'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import type { Goods, GoodType } from 'ssh/types'
import type { IdlePlan, Job, PickupPlan, Plan, TransferPlan, WorkPlan } from 'ssh/types/base'
import { gameObjectsModule } from 'ssh/types/game-objects'
import { axial, type Positioned, toAxialCoord } from 'ssh/utils'
import { subject } from '../scripts'
import { DurationStep } from '../steps'

function characterSameHexAsVehicle(character: Character, vehicle: VehicleEntity): boolean {
	const a = axial.round(toAxialCoord(character.position)!)
	const b = axial.round(toAxialCoord(vehicle.position)!)
	return axial.key(a) === axial.key(b)
}

/**
 * Claim line/offload service and `operates` at work-plan start; onboard when the job begins
 * driving on the vehicle hex (not when a `vehicleHop` still has a walk prelude via `approachPath`).
 */
function beginVehicleFreightWorkPlan(plan: WorkPlan, character: Character): void {
	if (plan.type !== 'work' || !('vehicleUid' in plan)) return
	const uid = plan.vehicleUid
	assert(uid, 'vehicle work plan: vehicleUid required')
	const vehicle = character.game.vehicles.vehicle(uid)
	assert(vehicle, 'vehicle work plan: vehicle missing')
	allocateVehicleServiceForJob(character.game, character, vehicle, plan as unknown as Job)

	const job = plan.job
	const hopNeedsWalkToVehicle = job === 'vehicleHop' && !!plan.approachPath?.length
	if (hopNeedsWalkToVehicle) return

	character.operates = vehicle
	/** `vehicleOffload` carries the walk-to-vehicle prefix in `path`; length 0 means already at the vehicle hex. */
	const vehicleOffloadAtVehicleHex = job === 'vehicleOffload' && (plan.path?.length ?? 0) === 0
	const needsImmediateBoard =
		!hopNeedsWalkToVehicle &&
		(job === 'vehicleHop' || job === 'zoneBrowse' || vehicleOffloadAtVehicleHex)

	if (needsImmediateBoard && !character.driving && characterSameHexAsVehicle(character, vehicle)) {
		character.onboard()
	}
	assertVehicleOperationConsistency(vehicle, character)
}

function releaseStaleVehicleBeforeNonVehicleWork(plan: WorkPlan, character: Character): void {
	if (plan.type !== 'work' || 'vehicleUid' in plan) return
	if (!character.operates) return
	releaseVehicleFreightWorkOnPlanInterrupt(character)
}

/**
 * A vehicle work plan owns the operator/control link for its duration. Service completion is decided
 * by vehicle-specific script steps; this finalizer only guarantees that a finished/interrupted plan
 * cannot leave the character still operating a wheelbarrow before self-care or other work resumes.
 */
function finalizeVehicleFreightWorkPlanOccupancy(plan: WorkPlan, character: Character): void {
	if (plan.type !== 'work' || !('vehicleUid' in plan)) return
	const vehicle = character.game.vehicles.vehicle(plan.vehicleUid)
	if (!vehicle) return
	const controlsPlanVehicle = character.operates?.uid === vehicle.uid
	const isPlanOperator = vehicle.operator?.uid === character.uid
	if (!controlsPlanVehicle && !isPlanOperator) return
	if (!vehicle.service) {
		if (controlsPlanVehicle) {
			if (character.driving) character.offboard()
			else character.operates = undefined
		}
		return
	}
	if (controlsPlanVehicle) {
		character.disengageVehicleKeepingService()
		return
	}
	if (isPlanOperator) vehicle.releaseOperator(character)
}

function getContentFromPosition(hex: HexBoard, position: Positioned) {
	const coord = toAxialCoord(position)
	if (!coord) return undefined
	return isTileCoord(coord) ? hex.getTileContent(coord) : hex.getBorderContent(coord)
}

function computeGrabGoods(plan: TransferPlan, character: Character, target: Positioned): Goods {
	const transport = character.carry
	assert(transport, 'grab plan requires active transport (driving)')
	const content = getContentFromPosition(character.game.hex, target)
	assert(content, 'target content must be set')
	assert('storage' in content, 'grab source must expose storage')
	const actualGoods: Goods = {}
	for (const [goodType, requestedQuantity] of Object.entries(plan.goods) as [GoodType, number][]) {
		if (!requestedQuantity || requestedQuantity <= 0) continue
		const canGrab = transport.hasRoom(goodType)
		if (canGrab <= 0) continue
		const available = content.storage?.available(goodType) ?? 0
		const amount = Math.min(canGrab, available, requestedQuantity)
		if (amount > 0) actualGoods[goodType] = amount
	}
	return actualGoods
}

// Plan handler interface
interface PlanHandler<T extends Plan> {
	begin(plan: T, character: Character): void
	conclude?(plan: T, character: Character): void
	cancel?(plan: T, character: Character): void
	finally?(plan: T, character: Character): void
}

// Transfer plan handler
const transferPlanHandler: PlanHandler<TransferPlan> = {
	begin(plan: TransferPlan, character: Character) {
		const hex = character.game.hex
		const { description, target } = plan
		const transport = character.carry

		// Create allocations based on plan type
		let vehicleAllocation: any
		let allocation: any
		try {
			if (plan.vehicleAllocation && plan.allocation) {
				vehicleAllocation = plan.vehicleAllocation
				allocation = plan.allocation
			} else {
				if (description === 'drop') {
					// Drop plans reserve destination storage only when the worker is
					// actually performing the transfer, otherwise border slots can be
					// "incoming" long before any good physically reaches them.
				} else if (description === 'grab') {
					// Grab plan: allocate vehicle space and reserve source storage
					assert(transport, 'grab requires active transport (driving)')
					assert(target, 'target must be set for storage grab')
					const content = getContentFromPosition(hex, target)
					assert(content, 'target content must be set')
					assert(
						'storage' in content,
						'planGrabStored only works with TileContent that has storage'
					)
					const goods = computeGrabGoods(plan, character, target)
					if (Object.keys(goods).length === 0) throw new Error('No goods to grab at execution time')
					plan.resolvedGoods = goods

					vehicleAllocation = transport.allocate(goods, `planGrab`)
					allocation = content.storage?.reserve(goods, `planGrabStored`)
				} else if (description === 'idle') {
					// Idle plan: do nothing (safe fallback)
				}
				// Set allocations on the plan
				Object.assign(plan, {
					vehicleAllocation,
					allocation,
				})
			}
		} catch (error) {
			try {
				allocation?.cancel()
			} catch {}
			try {
				vehicleAllocation?.cancel()
			} catch {}
			throw error
		}
	},

	conclude(plan: TransferPlan, _character: Character) {
		// Fulfill the allocations
		plan.allocation?.fulfill()
		plan.vehicleAllocation?.fulfill()
	},

	cancel(plan: TransferPlan, _character: Character) {
		// Cancel the allocations
		plan.allocation?.cancel()
		plan.vehicleAllocation?.cancel()
	},

	finally(plan: TransferPlan, _character: Character) {
		// Clear allocations back to undefined
		delete plan.vehicleAllocation
		delete plan.allocation
		delete plan.resolvedGoods
	},
}

// Pickup plan handler
const pickupPlanHandler: PlanHandler<PickupPlan> = {
	begin(plan: PickupPlan, character: Character) {
		const { goodType, target } = plan
		const transport = character.carry

		let vehicleAllocation: any
		let allocation: any
		try {
			if (plan.vehicleAllocation && plan.allocation) {
				vehicleAllocation = plan.vehicleAllocation
				allocation = plan.allocation
			} else {
				assert(transport, 'loose pickup requires active transport (driving)')
				// Find and allocate the loose good
				const coord = toAxialCoord(target)
				const looseGoods = character.game.hex.looseGoods.getGoodsAt(coord)
				const matchingLooseGoods = looseGoods.filter(
					(good) => good.goodType === goodType && good.available
				)

				if (matchingLooseGoods.length === 0) {
					console.warn(`No LooseGoods to grab for ${goodType}`)
					return
				}

				const looseGoodToGrab = matchingLooseGoods[0]
				// Allocate loose good FIRST (no reactive side-effects) so active-transport `allocate`
				// cannot fire effects that remove the good before it is secured.
				allocation = looseGoodToGrab.allocate(`planGrabLoose.${goodType}`)
				vehicleAllocation = transport.allocate({ [goodType]: 1 }, `planGrabLoose.${goodType}`)
				// NOTE: A prior `effect` on `looseGoodToGrab.isRemoved` called `cancelPlan` on removal.
				// Successful pickup removes the loose good after the vehicle allocation is fulfilled, which
				// aborted offload before `inventory.offloadDropBuffer()` could run.

				// Set allocations on the plan
				Object.assign(plan, {
					vehicleAllocation,
					allocation,
				})
			}
		} catch (error) {
			try {
				allocation?.cancel()
			} catch {}
			try {
				vehicleAllocation?.cancel()
			} catch {}
			throw error
		}
	},

	conclude(plan: PickupPlan, _character: Character) {
		// Fulfill the allocations
		plan.allocation?.fulfill()
		plan.vehicleAllocation?.fulfill()
	},

	cancel(plan: PickupPlan, _character: Character) {
		// Cancel the allocations
		plan.allocation?.cancel()
		plan.vehicleAllocation?.cancel()
	},

	finally(plan: PickupPlan, _character: Character) {
		// Clear allocations back to undefined
		delete plan.vehicleAllocation
		delete plan.allocation
	},
}

// Work plan handler
const workPlanHandler: PlanHandler<WorkPlan> = {
	begin(plan: WorkPlan, character: Character) {
		beginVehicleFreightWorkPlan(plan, character)
		releaseStaleVehicleBeforeNonVehicleWork(plan, character)
		const { target } = plan
		if (plan.job === 'vehicleOffload') {
			assert('targetCoord' in plan, 'vehicleOffload requires targetCoord')
			// Only `loadFromBurden` needs an upfront pickup binding; `unloadToTile` / `park` carry no
			// pickup payload (their drop / park targets are read from `vehicle.service` at run time).
			// Pickup allocation needs {@link Character.requireActiveTransportStorage} — only after boarding.
			if (character.driving && plan.maintenanceKind === 'loadFromBurden') {
				const pickupTile = character.game.hex.getTile(plan.targetCoord)
				assert(
					pickupTile && 'availableGoods' in pickupTile,
					'vehicleOffload pickup target must be a tile with loose goods'
				)
				assert(plan.looseGood, 'loadFromBurden plan must carry a looseGood')
				const pickupPlan = character.scriptsContext.inventory.planGrabSpecificLoose(
					plan.looseGood,
					pickupTile
				)
				assert(pickupPlan.type === 'pickup', 'vehicleOffload engagement must bind to a pickup plan')
				plan.offloadPickupPlan = pickupPlan
			}
		}
		// Assign worker only for alveoli
		if (gameObjectsModule.Alveolus.allows(target)) {
			const alreadyAssigned =
				target.assignedWorker === character && character.assignedAlveolus === (target as Alveolus)
			;(plan as WorkPlan & { preserveAssignment?: boolean }).preserveAssignment = alreadyAssigned
			if (!alreadyAssigned) {
				const currentAssigned = character.assignedAlveolus
				if (currentAssigned && currentAssigned !== target) {
					if (currentAssigned.assignedWorker === character)
						currentAssigned.assignedWorker = undefined
					character.assignedAlveolus = undefined
				}
				if (target.assignedWorker && target.assignedWorker !== character) {
					const previousWorker = target.assignedWorker
					target.assignedWorker = undefined
					if (previousWorker.assignedAlveolus === (target as Alveolus)) {
						previousWorker.assignedAlveolus = undefined
					}
				}
				target.assignedWorker = character
				character.assignedAlveolus = target as Alveolus
			}
		}

		// Set the assigned worker in the plan
		Object.assign(plan, {
			assignedWorker: character,
		})
	},

	cancel(plan: WorkPlan, character: Character) {
		if ('offloadPickupPlan' in plan && plan.offloadPickupPlan) {
			pickupPlanHandler.cancel?.(plan.offloadPickupPlan, character)
		}
		if ('vehicleUid' in plan) {
			releaseVehicleFreightWorkOnPlanInterrupt(character)
			if (character.operates) character.operates = undefined
		}
	},

	finally(plan: WorkPlan, character: Character) {
		if ('offloadPickupPlan' in plan && plan.offloadPickupPlan) {
			pickupPlanHandler.finally?.(plan.offloadPickupPlan, character)
			delete plan.offloadPickupPlan
		}
		finalizeVehicleFreightWorkPlanOccupancy(plan, character)
		if (
			gameObjectsModule.Alveolus.allows(plan.target) &&
			!(plan as WorkPlan & { preserveAssignment?: boolean }).preserveAssignment
		) {
			if (plan.target.assignedWorker === character) {
				plan.target.assignedWorker = undefined
			}
			if (character.assignedAlveolus === plan.target) {
				character.assignedAlveolus = undefined
			}
		}
	},
}

// Idle plan handler
const idlePlanHandler: PlanHandler<IdlePlan> = {
	begin(plan: IdlePlan, character: Character) {
		// Just wait
		character.stepExecutor = new DurationStep(plan.duration, 'idle', 'panic-wait')
	},
}

// Handler registry
const planHandlers: Record<Plan['type'], PlanHandler<any>> = {
	transfer: transferPlanHandler,
	pickup: pickupPlanHandler,
	work: workPlanHandler,
	idle: idlePlanHandler,
}

class PlanFunctions {
	declare [subject]: Character

	// No @contract decorators needed - Plan types are simple interfaces
	begin(plan: Plan) {
		if (!plan) return
		this[subject].logAbout(plan, `${plan.type}: begun`)
		try {
			planHandlers[plan.type].begin(plan, this[subject])
		} catch (error) {
			try {
				if ('releaseStopper' in plan) plan.releaseStopper?.()
			} catch {}
			try {
				planHandlers[plan.type].cancel?.(plan, this[subject])
			} catch {}
			try {
				planHandlers[plan.type].finally?.(plan, this[subject])
			} catch {}
			throw error
		}
	}

	conclude(plan: Plan) {
		if (!plan) return
		this[subject].logAbout(plan, `${plan.type}: concluded`)

		if (plan.invariant) {
			try {
				if (!plan.invariant()) {
					console.error(`Plan ${plan.type} invariant failed`)
					// Treat invariant failure as grounds for throwing, or just logging?
					// User said "invariant: a test to assert at the end".
					// Usually assertions throw.
					throw new Error(`Plan ${plan.type} invariant failed`)
				}
			} catch (e) {
				console.error(`Error executing plan ${plan.type} invariant:`, e)
				throw e
			}
		}

		if ('releaseStopper' in plan) plan.releaseStopper?.()
		planHandlers[plan.type].conclude?.(plan, this[subject])
	}

	cancel(plan: Plan) {
		if (!plan) return
		this[subject].logAbout(plan, `${plan.type}: cancelled`)
		if ('releaseStopper' in plan) plan.releaseStopper?.()
		planHandlers[plan.type].cancel?.(plan, this[subject])
	}

	finally(plan: Plan) {
		if (!plan) return
		planHandlers[plan.type].finally?.(plan, this[subject])
	}
}

export { PlanFunctions }
