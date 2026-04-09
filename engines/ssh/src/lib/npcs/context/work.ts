import { atomic } from 'mutts'
import type { LocalMovingGood } from 'ssh/board'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { LooseGood } from 'ssh/board/looseGoods'
import { assert } from 'ssh/debug'
import { alveolusClass } from 'ssh/hive'
import { BuildAlveolus } from 'ssh/hive/build'
import type { StorageAlveolus } from 'ssh/hive/storage'
import type { TransformAlveolus } from 'ssh/hive/transform'
import type { Character } from 'ssh/population/character'
import type { AllocationBase } from 'ssh/storage'
import { contract, type Goods, type GoodType } from 'ssh/types'
import type { AxialCoord } from 'ssh/utils'
import { alveoli } from '../../../../assets/game-content'
import { subject } from '../scripts'
import { DurationStep, MultiMoveStep } from '../steps'
import type { WorkPlan } from '.'
import { getConveyDuration, getConveyVisualMovements } from './convey'
import {
	cleanupFailedConveyMovement,
	type FailedConveyMovementData,
	isRecoverableConveyError,
} from './convey-cleanup'

/**
 * Runtime snapshot for a single convey sub-movement.
 *
 * - `mg` is the authoritative transfer token tracked by the hive.
 * - `from` is the origin snapshot captured before `mg.hop()` mutates `mg.from`.
 * - `hop` is the coordinate reached by this step.
 * - `hopAlloc` is the temporary destination allocation for intermediate hops only.
 * - `moving` is the transient loose-good used for the visual in-transit representation.
 */
interface MovementData {
	mg: LocalMovingGood
	hopAlloc?: AllocationBase
	hop: AxialCoord
	from: AxialCoord
	moving: LooseGood
}

class WorkFunctions {
	declare [subject]: Character
	@contract('WorkPlan')
	prepare(workPlan: WorkPlan) {
		if (['convey', 'offload'].includes(workPlan.job)) return
		assert(
			this[subject].assignedAlveolus?.preparationTime,
			'assignedAlveolus must be set and have a preparationTime'
		)
		return new DurationStep(
			this[subject].assignedAlveolus!.preparationTime,
			'work',
			`prepare.${workPlan.job}`
		)
	}

	@contract()
	myNextJob() {
		const alveolus = this[subject].assignedAlveolus
		assert(alveolus, 'assignedAlveolus must be set')
		assert(
			'nextJob' in alveolus && typeof alveolus.nextJob === 'function',
			'alveolus must have nextJob method'
		)
		return alveolus.nextJob(this[subject])
	}
	@contract()
	waitForIncomingGoods() {
		// Bounded poll to avoid getting stuck forever on one alveolus while
		// the actionable movement is elsewhere in the hive.
		return new DurationStep(0.3, 'idle', 'waitForIncomingGoods')
	}
	@contract()
	@atomic
	conveyStep() {
		const character = this[subject]
		const claimMovement = (mg: LocalMovingGood) => {
			mg.claimed = true
			;(mg as any).claimedBy = character.uid
			;(mg as any).claimedAtMs = Date.now()
		}
		const releaseMovementClaim = (mg: LocalMovingGood) => {
			mg.claimed = false
			delete (mg as any).claimedBy
			delete (mg as any).claimedAtMs
		}
		const alveolus = character.assignedAlveolus!
		assert(
			alveolus === character.tile.content,
			'Character must be assigned to the alveolus on the same tile'
		)
		// Get movement(s) - either a single movement or a cycle
		const movements = alveolus.aGoodMovement
		if (!movements || movements.length === 0) return

		const hive = alveolus.hive

		const movementData: MovementData[] = []

		for (const mg of movements) {
			const from = mg.from
			let sourceFulfilled = false
			let hopAlloc: AllocationBase | undefined
			let moving: LooseGood | undefined
			if (
				!hive.ensureMovementInvariant(mg, {
					expectedFrom: from,
					warnLabel: '[conveyStep] Invalid movement before pickup',
					allowClaimedSourceGap: false,
				})
			) {
				continue
			}
			if (!mg.allocations?.source) {
				console.warn('[conveyStep] Missing source allocation', mg)
				continue
			}
			try {
				claimMovement(mg)
				mg.allocations.source.fulfill()
				sourceFulfilled = true
				const hop = mg.hop()!

				// Only re-index the movement when another conveyor still needs to pick it up.
				// Final-hop movements should stay out of hive.movingGoods; otherwise terminal
				// path=[] ghost entries can linger at the destination and poison job selection.
				if (mg.path.length) {
					mg.place()
					if (
						!hive.ensureMovementInvariant(mg, {
							expectedFrom: hop,
							warnLabel: '[conveyStep] Invalid movement after place',
							allowClaimedSourceGap: true,
						})
					) {
						throw new Error('Movement became invalid after place')
					}
				}

				const nextStorage = hive.storageAt(hop)
				assert(nextStorage, 'nextStorage must be defined')
				hopAlloc = mg.path.length
					? nextStorage.allocate({ [mg.goodType]: 1 }, { type: 'convey.hop', movement: mg })
					: undefined

				moving = character.game.hex.looseGoods.add(from, mg.goodType, {
					position: from,
					available: false,
				})

				movementData.push({
					mg,
					hopAlloc,
					hop,
					from,
					moving,
				})
			} catch (error) {
				cleanupFailedConveyMovement(character, {
					mg,
					hopAlloc,
					from,
					moving,
					sourceFulfilled,
				} satisfies FailedConveyMovementData)
				for (const prev of movementData) cleanupFailedConveyMovement(character, prev)
				if (isRecoverableConveyError(error)) {
					console.warn('[conveyStep] Recovered from stale movement bookkeeping', {
						goodType: mg.goodType,
						provider: mg.provider.name,
						demander: mg.demander.name,
						error: error.message,
					})
					hive.wakeWanderingWorkersNear(mg.provider, mg.demander)
					return
				}
				throw error
			}
		}
		if (movementData.length === 0) return

		const totalTime = getConveyDuration(character.vehicle.transferTime, movementData)

		// Create unified MultiMoveStep that animates all movements
		const description =
			movementData.length === 1 ? `convey.${movementData[0].mg.goodType}` : `convey.cycle`
		const visualMovements = getConveyVisualMovements(movementData)
		return new MultiMoveStep(totalTime, visualMovements, 'work', description)
			.canceled(() => {
				for (const { mg, hopAlloc, moving } of movementData) {
					releaseMovementClaim(mg)
					hopAlloc?.cancel()
					mg.allocations.source.cancel()
					mg.allocations.target.cancel()
					if (!moving.isRemoved) moving.remove()
					character.game.hex.looseGoods.add(character.tile, mg.goodType)
					mg.finish()
				}
			})
			.finished(() => {
				try {
					for (const { mg, moving, hopAlloc, hop } of movementData) {
						const nextStorage = hive.storageAt(hop)

						if (!moving.isRemoved) moving.remove()
						if (!mg.path.length) {
							if (!mg.allocations?.target) {
								console.error('Target allocation missing for', mg)
								throw new Error('Target allocation missing')
							}
							releaseMovementClaim(mg)
							mg.finish()
						} else {
							if (!hopAlloc) {
								console.error('Hop allocation missing (but path exists) for', mg)
								throw new Error('Hop allocation missing')
							}

							hopAlloc.fulfill()

							const newSourceAlloc = nextStorage!.reserve(
								{ [mg.goodType]: 1 },
								{
									type: 'convey.path',
									goodType: mg.goodType,
									movementId: mg._mgId,
									providerRef: mg.provider,
									demanderRef: mg.demander,
									providerName: mg.provider.name,
									demanderName: mg.demander.name,
									movement: mg,
								}
							)

							if (!newSourceAlloc) {
								console.error(
									'[conveyStep.finished] Failed to reserve storage for next hop:',
									mg.goodType
								)
								throw new Error('Failed to reserve storage for next hop')
							}

							mg.allocations.source = newSourceAlloc
							if (
								!hive.ensureMovementInvariant(mg, {
									expectedFrom: hop,
									warnLabel: '[conveyStep] Invalid movement after hop handoff',
								})
							) {
								throw new Error('Movement became invalid after hop handoff')
							}
							releaseMovementClaim(mg)
							hive.wakeWanderingWorkersNear(mg.provider, mg.demander)
						}
					}
				} catch (error) {
					for (const movement of movementData) cleanupFailedConveyMovement(character, movement)
					if (isRecoverableConveyError(error)) {
						console.warn('[conveyStep] Recovered from stale movement bookkeeping in finish', {
							error: error.message,
							movements: movementData.map(({ mg }) => ({
								goodType: mg.goodType,
								provider: mg.provider.name,
								demander: mg.demander.name,
							})),
						})
						for (const { mg } of movementData) {
							hive.wakeWanderingWorkersNear(mg.provider, mg.demander)
						}
						return
					}
					console.error('[conveyStep] Error in finished callback:', error)
					throw error
				}
			})
			.final(() => {
				// Clean up any remaining loose goods. Note: looseGoods should *not* disappear. For now, this shouldn't happen - but if it happened, looseGoods should be stored as looseGoods
				for (const { moving } of movementData) {
					if (!moving.isRemoved) debugger
				}
			})
	}
	@contract()
	harvestStep() {
		const unbuiltLand = this[subject].tile.content as UnBuiltLand
		if (!(unbuiltLand instanceof UnBuiltLand)) {
			console.error(
				`[harvestStep] Tile content not UnBuiltLand: ${this[subject].tile.content?.constructor.name}`
			)
			return
		}
		// assert(unbuiltLand instanceof UnBuiltLand, 'tile.content must be an UnBuiltLand')
		const alveolus = this[subject].assignedAlveolus as Ssh.AlveolusDefinition<Ssh.HarvestingAction>
		assert(alveolus, 'assignedAlveolus must be set')
		assert(alveolus.action.type === 'harvest', 'assignedAlveolus.action must be a harvest')
		const action = alveolus.action as Ssh.HarvestingAction
		assert(
			action.deposit === unbuiltLand.deposit?.name,
			'assignedAlveolus.action.deposit must be the same as tile.content.deposit.name'
		)
		const deposit = unbuiltLand.deposit!
		// Check if character can store any of the output goods
		const outputGoods = alveolus.action.output
		const canStoreAny = Object.keys(outputGoods).some(
			(goodType) => this[subject].carry.hasRoom(goodType as GoodType) > 0
		)
		if (!canStoreAny) return
		deposit.amount -= 1
		if (deposit.amount <= 0) unbuiltLand.deposit = undefined
		return new DurationStep(
			this[subject].assignedAlveolus!.workTime,
			'work',
			`harvest.${this[subject].assignedAlveolus!.name}`
		).finished(() => {
			// Add all output goods to character inventory
			Object.entries(alveolus.action.output).forEach(([goodType, qty]) => {
				this[subject].carry.addGood(goodType as GoodType, qty)
			})
		})
	}
	@contract()
	transformStep() {
		const alveolus = this[subject].assignedAlveolus as TransformAlveolus
		assert(alveolus, 'assignedAlveolus must be set')
		assert(alveolus.action.type === 'transform', 'assignedAlveolus.action must be a transform')
		const action = alveolus.action
		const allocations: AllocationBase[] = []
		const inputAllocation = alveolus.storage.reserve(action.inputs as Goods, {
			type: 'transform.input',
			alveolus,
			inputs: action.inputs,
		})
		allocations.push(inputAllocation)

		// 		const outputAllocation = alveolus.storage.allocate(action.output as Goods, {
		// 			type: 'transform.output',
		// 			alveolus,
		// 			output: action.output,
		// 		})
		// 		allocations.push(outputAllocation)
		// ^ Wait. I should replace matching the context.

		const outputAllocation = alveolus.storage.allocate(action.output as Goods, {
			type: 'transform.output',
			alveolus,
			output: action.output,
		})
		allocations.push(outputAllocation)

		return new DurationStep(alveolus.workTime, 'work', `transform.${alveolus.name}`)
			.finished(() => {
				for (const allocation of allocations) allocation.fulfill()
			})
			.canceled(() => {
				for (const allocation of allocations) allocation.cancel()
			})
	}
	@contract()
	defragmentStep() {
		const character = this[subject]
		const alveolus = character.assignedAlveolus as StorageAlveolus
		assert(
			alveolus.action.type === 'slotted-storage' || alveolus.action.type === 'specific-storage',
			'assignedAlveolus must be a StorageAlveolus'
		)
		const fragmentedGoodType = alveolus.storage.fragmented
		assert(fragmentedGoodType, 'alveolus must be fragmented')
		const take = alveolus.storage.allocate({ [fragmentedGoodType]: 1 }, { type: 'defragment.take' })
		const arrange = alveolus.storage.reserve(
			{ [fragmentedGoodType]: 1 },
			{ type: 'defragment.arrange' }
		)
		return new DurationStep(character.vehicle.transferTime, 'work', `defragment.${alveolus.name}`)
			.finished(() => {
				take.fulfill()
				arrange.fulfill()
			})
			.canceled(() => {
				take.cancel()
				arrange.cancel()
			})
	}
	@contract()
	foundationStep() {
		// Character must be on an UnBuiltLand tile with a project
		const content = this[subject].tile.content
		if (!(content instanceof UnBuiltLand) || !content.project) {
			return
		}
		// Redundant assert for TS narrowing, or just cast
		// assert(content instanceof UnBuiltLand, 'Tile must be UnBuiltLand')
		// assert(content.project, 'UnBuiltLand must have a project')

		// Extract the alveolus type from project (e.g., "build:sawmill" -> "sawmill")
		const alveolusType = content.project.replace('build:', '')

		return new DurationStep(3, 'work', 'foundation').finished(() => {
			// Create BuildAlveolus
			const buildAlveolus = new BuildAlveolus(content.tile, alveolusType as any)
			content.tile.content = buildAlveolus
		})
	}

	@contract()
	constructionStep() {
		// Character must already be on the construction site tile
		const content = this[subject].tile.content
		assert(content instanceof BuildAlveolus, 'Tile must be a BuildAlveolus')
		const site = content as BuildAlveolus
		assert(site.isReady, 'Construction site must be ready')
		const targetType = site.target as keyof typeof alveolusClass
		const TargetClass = alveolusClass[targetType]
		assert(TargetClass, 'Target alveolus class must exist')
		return new DurationStep(
			alveoli[targetType].construction.time,
			'work',
			`construct.${targetType}`
		).finished(() => {
			site.tile.baseTerrain = 'concrete'
			site.tile.terrainState = {
				...(site.tile.terrainState ?? {}),
				terrain: 'concrete',
			}
			site.tile.game.upsertTerrainOverride(site.tile.position as { q: number; r: number }, {
				terrain: 'concrete',
			})
			// Replace the tile content with the target alveolus
			site.tile.content = new TargetClass(site.tile)
		})
	}
}

export { WorkFunctions }
