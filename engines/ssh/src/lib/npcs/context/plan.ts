/** Plan begin/conclude for transfers; reservations use {@link Character.carry} (vehicle storage when driving). */
import { type HexBoard, isTileCoord } from 'ssh/board'
import type { Alveolus } from 'ssh/board/content/alveolus'
import { assertVehicleOperationConsistency } from 'ssh/freight/vehicle-invariants'
import { releaseVehicleFreightWorkOnPlanInterrupt } from 'ssh/freight/vehicle-run'
import { allocateVehicleServiceForJob } from 'ssh/freight/vehicle-work'
import type { Character } from 'ssh/population/character'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import { isVehicleMaintenanceService } from 'ssh/population/vehicle/vehicle'
import type { Goods, GoodType } from 'ssh/types'
import type { IdlePlan, Job, PickupPlan, Plan, TransferPlan, WorkPlan } from 'ssh/types/base'
import { gameObjectsModule } from 'ssh/types/game-objects'
import { axial, type Positioned, toAxialCoord } from 'ssh/utils'
import { assert } from '../../dev/debug.ts'
import { subject } from '../scripts'
import { DurationStep } from '../steps'
import { PlanCommitment } from './plan-commitment'

function characterSameHexAsVehicle(character: Character, vehicle: VehicleEntity): boolean {
	const a = axial.round(toAxialCoord(character.position)!)
	const b = axial.round(toAxialCoord(vehicle.effectivePosition)!)
	return axial.key(a) === axial.key(b)
}

/**
 * Claim line/offload service and `operates` at work-plan start. A `vehicleHop` approach still
 * walks on foot, but it owns the vehicle usage while walking and only boards at the vehicle hex.
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

function clearVehicleOffloadPickupPlanMirror(plan: WorkPlan, character: Character): void {
	if (!('vehicleUid' in plan) || !('offloadPickupPlan' in plan) || !plan.offloadPickupPlan) return
	const vehicle = character.game.vehicles.vehicle(plan.vehicleUid)
	const svc = vehicle?.service
	if (isVehicleMaintenanceService(svc) && svc.kind === 'loadFromBurden') {
		if (svc.offloadPickupPlan === plan.offloadPickupPlan) delete svc.offloadPickupPlan
	}
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
		let commitment: PlanCommitment | undefined
		try {
			if (plan.vehicleAllocation && plan.allocation) {
				// Legacy path — allocations already created (e.g. from inventory.ts)
				commitment = new PlanCommitment(`transfer.${plan.description}`)
				// Mirror allocations on the commitment so auto-cancel cascades
				;(commitment as any).allocation = plan.allocation
				;(commitment as any).vehicleAllocation = plan.vehicleAllocation

				commitment.onFulfilled(() => {
					;(plan.allocation as any)?.fulfill()
					;(plan.vehicleAllocation as any)?.fulfill()
					delete plan.resolvedGoods
				})

				commitment.onFinal(() => {
					delete plan.vehicleAllocation
					delete plan.allocation
					delete plan.resolvedGoods
				})
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

					commitment = new PlanCommitment(`transfer.grab.${plan.description}`)

					// Storage calls register their lifecycle callbacks on the commitment
					const allocResult = transport.allocate(goods, commitment)
					if (allocResult !== undefined) throw new Error(allocResult)
					const reserveResult = content.storage?.reserve(goods, commitment)
					if (reserveResult !== undefined) throw new Error(reserveResult)

					commitment.onFinal(() => {
						delete plan.resolvedGoods
					})
				} else if (description === 'idle') {
					// Idle plan: do nothing (safe fallback)
				}
			}
		} catch (error) {
			commitment?.cancel('begin-error')
			throw error
		}

		// Link commitment back to the plan for external lifecycle calls
		if (commitment) {
			;(plan as any).commitment = commitment
		}
	},

	// conclude/cancel/finally removed — PlanCommitment handles allocation lifecycle
}

// Pickup plan handler
const pickupPlanHandler: PlanHandler<PickupPlan> = {
	begin(plan: PickupPlan, character: Character) {
		const { goodType, target } = plan
		const transport = character.carry
		const existingCommitment = plan.commitment
		if (
			existingCommitment &&
			'trace' in existingCommitment &&
			typeof existingCommitment.trace === 'function'
		) {
			existingCommitment.trace('pickup.planHandler.begin.enter', {
				goodType,
				target: toAxialCoord(target),
				characterUid: character.uid,
				characterName: character.name,
				hasLegacyAllocation: Boolean(plan.vehicleAllocation && plan.allocation),
			})
		}

		let commitment: PlanCommitment | undefined
		try {
			if (plan.vehicleAllocation && plan.allocation) {
				// Legacy path — allocations already created (e.g. from inventory.ts)
				commitment = new PlanCommitment(`pickup.${plan.goodType}`).addTraceInfo({
					kind: 'pickup-plan-handler',
					goodType,
					target: toAxialCoord(target),
					characterUid: character.uid,
					characterName: character.name,
					vehicleUid: character.operates?.uid,
					legacy: true,
				})
				commitment.trace('pickup.planHandler.legacyCommitment.created')
				;(commitment as any).allocation = plan.allocation
				;(commitment as any).vehicleAllocation = plan.vehicleAllocation

				commitment.onFulfilled(() => {
					;(plan.allocation as any)?.fulfill()
					;(plan.vehicleAllocation as any)?.fulfill()
				})

				commitment.onFinal(() => {
					delete plan.vehicleAllocation
					delete plan.allocation
				})
			} else {
				assert(transport, 'loose pickup requires active transport (driving)')
				// Find and allocate the loose good
				const coord = toAxialCoord(target)
				const looseGoods = character.game.hex.looseGoods.getGoodsAt(coord)
				const matchingLooseGoods = looseGoods.filter(
					(good) => good.goodType === goodType && good.available
				)

				if (matchingLooseGoods.length === 0) {
					if (
						existingCommitment &&
						'trace' in existingCommitment &&
						typeof existingCommitment.trace === 'function'
					) {
						existingCommitment.trace('pickup.planHandler.noMatchingLooseGoods', {
							goodType,
							target: coord,
						})
					}
					console.warn(`No LooseGoods to grab for ${goodType}`)
					return
				}

				const looseGoodToGrab = matchingLooseGoods[0]

				if (
					existingCommitment &&
					'trace' in existingCommitment &&
					typeof existingCommitment.trace === 'function'
				) {
					existingCommitment.trace('pickup.planHandler.replacingExistingCommitment', {
						replacementLabel: `pickup.${plan.goodType}`,
					})
				}

				commitment = new PlanCommitment(`pickup.${plan.goodType}`).addTraceInfo({
					kind: 'pickup-plan-handler',
					goodType,
					target: coord,
					characterUid: character.uid,
					characterName: character.name,
					vehicleUid: character.operates?.uid,
					replacedCommitment: existingCommitment ? 'yes' : 'no',
				})
				commitment.trace('pickup.planHandler.commitment.created')

				// Allocate loose good FIRST (no reactive side-effects) so active-transport `allocate`
				// cannot fire effects that remove the good before it is secured.
				const looseResult = looseGoodToGrab.allocate(commitment)
				if (looseResult !== undefined) throw new Error(looseResult)
				commitment.trace('pickup.planHandler.looseAllocated')

				const vehicleResult = transport.allocate({ [goodType]: 1 }, commitment)
				if (vehicleResult !== undefined) throw new Error(vehicleResult)
				commitment.trace('pickup.planHandler.transportAllocated')

				// NOTE: A prior `effect` on `looseGoodToGrab.isRemoved` called `cancelPlan` on removal.
				// Successful pickup removes the loose good after the vehicle allocation is fulfilled, which
				// aborted offload before `inventory.offloadDropBuffer()` could run.
			}
		} catch (error) {
			commitment?.cancel('begin-error')
			throw error
		}

		if (commitment) {
			commitment.trace('pickup.planHandler.assignedToPlan')
			;(plan as any).commitment = commitment
		}
	},

	// conclude/cancel/finally removed — PlanCommitment handles allocation lifecycle
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
				const vehicle = character.game.vehicles.vehicle(plan.vehicleUid)
				const svc = vehicle?.service
				if (isVehicleMaintenanceService(svc) && svc.kind === 'loadFromBurden') {
					svc.offloadPickupPlan = pickupPlan
				}
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
			// Cancel via commitment (pickup handler no longer has its own cancel)
			if (plan.offloadPickupPlan.commitment) {
				plan.offloadPickupPlan.commitment.cancel('work-plan-cancelled')
			}
			clearVehicleOffloadPickupPlanMirror(plan, character)
		}
		if ('vehicleUid' in plan) {
			releaseVehicleFreightWorkOnPlanInterrupt(character)
			if (character.operates) character.operates = undefined
		}
	},

	finally(plan: WorkPlan, character: Character) {
		if ('offloadPickupPlan' in plan && plan.offloadPickupPlan) {
			// Commitment.onFinal already runs during fulfill/cancel; just remove the plan reference
			clearVehicleOffloadPickupPlanMirror(plan, character)
			delete plan.offloadPickupPlan
		}
		finalizeVehicleFreightWorkPlanOccupancy(plan, character)
		const shouldPreserveAssignment =
			(plan as WorkPlan & { preserveAssignment?: boolean }).preserveAssignment &&
			plan.job !== 'convey'
		if (gameObjectsModule.Alveolus.allows(plan.target) && !shouldPreserveAssignment) {
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
				// Use commitment-based cascade; handler.cancel is optional fallback for work plans
				if ('commitment' in plan && plan.commitment) {
					plan.commitment.cancel('begin-error')
				} else {
					planHandlers[plan.type].cancel?.(plan, this[subject])
				}
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
					throw new Error(`Plan ${plan.type} invariant failed`)
				}
			} catch (e) {
				console.error(`Error executing plan ${plan.type} invariant:`, e)
				throw e
			}
		}

		if ('releaseStopper' in plan) plan.releaseStopper?.()

		// Delegate to commitment first (transfer/pickup plans), then handler for work plans
		if ('commitment' in plan && plan.commitment) {
			plan.commitment.fulfill()
		}
		planHandlers[plan.type].conclude?.(plan, this[subject])
	}

	cancel(plan: Plan) {
		if (!plan) return
		this[subject].logAbout(plan, `${plan.type}: cancelled`)
		if ('releaseStopper' in plan) plan.releaseStopper?.()

		// Use commitment-based cascade first; handler.cancel is fallback for work plans
		if ('commitment' in plan && plan.commitment) {
			plan.commitment.cancel('plan-cancelled')
		} else {
			planHandlers[plan.type].cancel?.(plan, this[subject])
		}
	}

	finally(plan: Plan) {
		if (!plan) return
		// Commitment.onFinal already runs during fulfill/cancel — only call handler.finally
		// for work plans that still need vehicle occupancy cleanup
		planHandlers[plan.type].finally?.(plan, this[subject])
	}
}

export { PlanFunctions }
