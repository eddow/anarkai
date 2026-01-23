import { assert, namedEffect } from '$lib/debug'
import { type HexBoard, isTileCoord } from '$lib/board'
import { Alveolus } from '$lib/board/content/alveolus'
import type { Character } from '$lib/population/character'
import type { IdlePlan, PickupPlan, Plan, TransferPlan, WorkPlan } from '$lib/types/base'
import { type Positioned, toAxialCoord } from '$lib/utils'
import { gameObjectsModule } from '$lib/types/game-objects'
import { subject } from '../scripts'
import { DurationStep } from '../steps'

function getContentFromPosition(hex: HexBoard, position: Positioned) {
	const coord = toAxialCoord(position)
	if (!coord) return undefined
	return isTileCoord(coord) ? hex.getTileContent(coord) : hex.getBorderContent(coord)
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
		const { goods, description, target } = plan
		const vehicle = character.vehicle

		assert(vehicle, 'vehicle must be set')

		// Create allocations based on plan type
		let vehicleAllocation: any
		let allocation: any
		try {
			if (plan.vehicleAllocation && plan.allocation) {
				vehicleAllocation = plan.vehicleAllocation
				allocation = plan.allocation
			} else {
				if (description === 'drop') {
					// Drop plan: allocate vehicle space and destination storage
					assert(target, 'target must be set for drop plan')
					const content = getContentFromPosition(hex, target)
					assert(content, 'target content must be set')
					assert('storage' in content, 'planDropStored only works with TileContent that has storage')

					vehicleAllocation = vehicle.storage.reserve(goods, `planDropStored`)
					allocation = content.storage!.allocate(goods, `planDropStored`)
				} else if (description === 'grab') {
					// Grab plan: allocate vehicle space and reserve source storage
					assert(target, 'target must be set for storage grab')
					const content = getContentFromPosition(hex, target)
					assert(content, 'target content must be set')
					assert('storage' in content, 'planGrabStored only works with TileContent that has storage')

					vehicleAllocation = vehicle.storage.allocate(goods, `planGrab`)
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
	},
}

// Pickup plan handler
const pickupPlanHandler: PlanHandler<PickupPlan> = {
	begin(plan: PickupPlan, character: Character) {
		const { goodType, target } = plan
		const vehicle = character.vehicle

		assert(vehicle, 'vehicle must be set')

		let vehicleAllocation: any
		let allocation: any
		let releaseStopper: any
		try {
			if (plan.vehicleAllocation && plan.allocation) {
				vehicleAllocation = plan.vehicleAllocation
				allocation = plan.allocation
			} else {
				// Find and allocate the free good
				const coord = toAxialCoord(target)
				const freeGoods = character.game.hex.freeGoods.getGoodsAt(coord)
				const matchingFreeGoods = freeGoods.filter(
					(good) => good.goodType === goodType && good.available,
				)

				if (matchingFreeGoods.length === 0) {
					console.warn(`No FreeGoods to grab for ${goodType}`)
					return
				}

				const freeGoodToGrab = matchingFreeGoods[0]
				vehicleAllocation = vehicle.storage.allocate(
					{ [goodType]: 1 },
					`planGrabFree.${goodType}`,
				)
				allocation = freeGoodToGrab.allocate(`planGrabFree.${goodType}`)
				releaseStopper = namedEffect('plan.releaseStopper', () => {
					if (freeGoodToGrab.isRemoved) character.cancelPlan(plan)
				})
				plan.releaseStopper = releaseStopper

				// Set allocations on the plan
				Object.assign(plan, {
					vehicleAllocation,
					allocation,
				})
			}
		} catch (error) {
			try {
				releaseStopper?.()
			} catch {}
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
		const { target } = plan
		// Assign worker only for alveoli
		if (gameObjectsModule.Alveolus.allows(target)) {
			target.assignedWorker = character
			character.assignedAlveolus = target as Alveolus
		}

		// Set the assigned worker in the plan
		Object.assign(plan, {
			assignedWorker: character,
		})
	},

	finally(plan: WorkPlan, character: Character) {
		if (gameObjectsModule.Alveolus.allows(plan.target)) {
			plan.target.assignedWorker = undefined
			character.assignedAlveolus = undefined
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
			} catch(e) {
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
