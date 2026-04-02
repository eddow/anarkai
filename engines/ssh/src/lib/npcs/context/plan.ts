import { effect } from 'mutts'
import { type HexBoard, isTileCoord } from 'ssh/board'
import type { Alveolus } from 'ssh/board/content/alveolus'
import { assert } from 'ssh/debug'
import type { Character } from 'ssh/population/character'
import type { Goods, GoodType } from 'ssh/types'
import type { IdlePlan, PickupPlan, Plan, TransferPlan, WorkPlan } from 'ssh/types/base'
import { gameObjectsModule } from 'ssh/types/game-objects'
import { type Positioned, toAxialCoord } from 'ssh/utils'
import { subject } from '../scripts'
import { DurationStep } from '../steps'

function getContentFromPosition(hex: HexBoard, position: Positioned) {
	const coord = toAxialCoord(position)
	if (!coord) return undefined
	return isTileCoord(coord) ? hex.getTileContent(coord) : hex.getBorderContent(coord)
}

function computeGrabGoods(plan: TransferPlan, character: Character, target: Positioned): Goods {
	const vehicle = character.vehicle
	assert(vehicle, 'vehicle must be set')
	const content = getContentFromPosition(character.game.hex, target)
	assert(content, 'target content must be set')
	assert('storage' in content, 'grab source must expose storage')
	const actualGoods: Goods = {}
	for (const [goodType, requestedQuantity] of Object.entries(plan.goods) as [GoodType, number][]) {
		if (!requestedQuantity || requestedQuantity <= 0) continue
		const canGrab = vehicle.storage.hasRoom(goodType)
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
					// Drop plans reserve destination storage only when the worker is
					// actually performing the transfer, otherwise border slots can be
					// "incoming" long before any good physically reaches them.
				} else if (description === 'grab') {
					// Grab plan: allocate vehicle space and reserve source storage
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
		delete plan.resolvedGoods
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
				// Allocate loose good FIRST (no reactive side-effects) so vehicle.storage.allocate
				// cannot fire effects that remove the good before it is secured.
				allocation = looseGoodToGrab.allocate(`planGrabLoose.${goodType}`)
				vehicleAllocation = vehicle.storage.allocate({ [goodType]: 1 }, `planGrabLoose.${goodType}`)
				releaseStopper = effect`plan.releaseStopper`(() => {
					if (looseGoodToGrab.isRemoved) character.cancelPlan(plan)
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
		if (plan.job === 'offload') {
			assert(target && 'availableGoods' in target, 'offload target must be a tile')
			const pickupPlan = character.scriptsContext.inventory.planGrabSpecificLoose(
				plan.looseGood,
				target
			)
			assert(pickupPlan.type === 'pickup', 'offload engagement must bind to a pickup plan')
			plan.offloadPickupPlan = pickupPlan
		}
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

	cancel(plan: WorkPlan, character: Character) {
		if (plan.offloadPickupPlan) {
			pickupPlanHandler.cancel?.(plan.offloadPickupPlan, character)
		}
	},

	finally(plan: WorkPlan, character: Character) {
		if (plan.offloadPickupPlan) {
			pickupPlanHandler.finally?.(plan.offloadPickupPlan, character)
			delete plan.offloadPickupPlan
		}
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
