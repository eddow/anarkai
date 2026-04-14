import { alveoli, waitForIncomingGoodsPollSeconds } from 'engine-rules'
import { atomic } from 'mutts'
import { isTileCoord } from 'ssh/board/board'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { LooseGood } from 'ssh/board/looseGoods'
import { assert } from 'ssh/debug'
import { alveolusClass } from 'ssh/hive'
import { BuildAlveolus } from 'ssh/hive/build'
import type { TrackedMovement } from 'ssh/hive/hive'
import { StorageAlveolus } from 'ssh/hive/storage'
import type { TransformAlveolus } from 'ssh/hive/transform'
import type { Character } from 'ssh/population/character'
import type { AllocationBase } from 'ssh/storage'
import { SlottedStorage } from 'ssh/storage/slotted-storage'
import { contract, type Goods, type GoodType } from 'ssh/types'
import { type AxialCoord, axial } from 'ssh/utils'
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
 * - `movement` is the authoritative transfer token tracked by the hive.
 * - `from` is the origin snapshot captured before `movement.hop()` mutates `movement.from`.
 * - `hop` is the coordinate reached by this step.
 * - `hopAlloc` is the temporary destination allocation for intermediate hops only.
 * - `moving` is the transient loose-good used for the visual in-transit representation.
 */
interface MovementData {
	movement: TrackedMovement
	hopAlloc?: AllocationBase
	hop: AxialCoord
	from: AxialCoord
	moving: LooseGood
}

function waitStep() {
	return new DurationStep(waitForIncomingGoodsPollSeconds, 'idle', 'waitForIncomingGoods')
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
		return waitStep()
	}
	@contract()
	@atomic
	conveyStep() {
		const character = this[subject]
		const currentHive = (movement: TrackedMovement) => {
			const hive = movement.provider.hive
			assert(hive, `conveyStep: provider hive missing for ${movement._mgId}`)
			assert(
				movement.demander.hive === hive,
				`conveyStep: provider/demander hive mismatch for ${movement._mgId}`
			)
			return hive
		}
		const claimMovement = (movement: TrackedMovement) => {
			assert(!movement.claimed, `claimMovement: movement already claimed ${movement._mgId}`)
			assert(!movement.claimedBy, `claimMovement: movement already has claimedBy ${movement._mgId}`)
			assert(
				!movement.claimedAtMs,
				`claimMovement: movement already has claimedAtMs ${movement._mgId}`
			)
			movement.claimed = true
			movement.claimedBy = character.uid
			movement.claimedAtMs = Date.now()
			movement.provider.hive.noteMovementLifecycle(movement, `movement.claimed.by:${character.uid}`)
		}
		const releaseMovementClaim = (movement: TrackedMovement) => {
			assert(movement.claimed, `releaseMovementClaim: movement not claimed ${movement._mgId}`)
			assert(
				movement.claimedBy === character.uid,
				`releaseMovementClaim: movement claimed by ${movement.claimedBy ?? 'nobody'} not ${character.uid}`
			)
			assert(
				!!movement.claimedAtMs,
				`releaseMovementClaim: movement missing claimedAtMs ${movement._mgId}`
			)
			movement.provider.hive.noteMovementLifecycle(
				movement,
				`movement.unclaimed.by:${character.uid}`
			)
			movement.claimed = false
			delete movement.claimedBy
			delete movement.claimedAtMs
		}
		const alveolus = character.assignedAlveolus!
		const assignedCoord = axial.key(alveolus.tile.position as AxialCoord)
		assert(
			alveolus === character.tile.content,
			'Character must be assigned to the alveolus on the same tile'
		)
		// Get movement(s) - either a single movement or a cycle
		const movements = alveolus.aGoodMovement
		if (!movements || movements.length === 0) {
			return alveolus.incomingGoods ? waitStep() : undefined
		}

		const hive = alveolus.hive

		const movementData: MovementData[] = []

		for (const selection of movements) {
			const movement = selection.movement
			const from = selection.fromSnapshot
			let sourceFulfilled = false
			let hopAlloc: AllocationBase | undefined
			let moving: LooseGood | undefined
			if (
				!hive.ensureMovementInvariant(movement, {
					expectedFrom: from,
					warnLabel: '[conveyStep] Invalid movement before pickup',
					allowClaimedSourceGap: false,
				})
			) {
				continue
			}
			hive.assertMovementMine(movement, {
				label: 'conveyStep.before-pickup',
				expectedFrom: from,
				expectClaimed: false,
				requireTracked: true,
				requireSourceValid: true,
				requireTargetValid: true,
			})
			if (!movement.allocations?.source) {
				console.warn('[conveyStep] Missing source allocation', movement)
				continue
			}
			try {
				const movementHive = currentHive(movement)
				movementHive.noteMovementLifecycle(movement, 'conveyStep.start')
				movementHive.noteMovementStorageCheckpoint(
					movement,
					'conveyStep.before-claim.storage',
					from
				)
				claimMovement(movement)
				movementHive.assertMovementMine(movement, {
					label: 'conveyStep.after-claim.before-source-fulfill',
					expectedFrom: from,
					expectClaimed: true,
					requireTracked: false,
					requireSourceValid: true,
					requireTargetValid: true,
					allowClaimedSourceGap: true,
					allowClaimedTerminalPath: true,
					allowUntracked: true,
				})
				movementHive.noteMovementStorageCheckpoint(
					movement,
					'conveyStep.before-source-fulfill.storage',
					from
				)
				movementHive.fulfillMovementSource(movement, 'conveyStep.pickup')
				sourceFulfilled = true
				movementHive.noteMovementStorageCheckpoint(
					movement,
					'conveyStep.after-source-fulfill.storage',
					from
				)
				movementHive.assertMovementMine(movement, {
					label: 'conveyStep.after-source-fulfill.before-hop',
					expectedFrom: from,
					expectClaimed: true,
					requireTracked: false,
					requireSourceValid: false,
					requireTargetValid: true,
					allowClaimedSourceGap: true,
					allowClaimedTerminalPath: true,
					allowUntracked: true,
				})
				const nextTile = movement.path[0]
				const nextBorder = movement.path[1]
				const bridgeCandidate =
					!isTileCoord(from) &&
					!!nextTile &&
					!!nextBorder &&
					isTileCoord(nextTile) &&
					!isTileCoord(nextBorder) &&
					axial.key(nextTile) === assignedCoord
				let hop = movement.hop()!
				if (bridgeCandidate) {
					const bridgeTile = hop
					movementHive.noteMovementLifecycle(
						movement,
						`conveyStep.bridge.enter:${axial.key(bridgeTile)}`
					)
					hop = movement.hop()!
					movementHive.noteMovementLifecycle(movement, `conveyStep.bridge.exit:${axial.key(hop)}`)
					movementHive.noteMovementStorageCheckpoint(
						movement,
						'conveyStep.bridge.exit.storage',
						hop
					)
				}

				// Only re-index the movement when another conveyor still needs to pick it up.
				// Final-hop movements should stay out of hive.movingGoods; otherwise terminal
				// path=[] ghost entries can linger at the destination and poison job selection.
				if (movement.path.length) {
					movement.place()
					currentHive(movement).noteMovementStorageCheckpoint(
						movement,
						'conveyStep.after-place.storage',
						hop
					)
					currentHive(movement).assertMovementMine(movement, {
						label: 'conveyStep.after-place',
						expectedFrom: hop,
						expectClaimed: true,
						requireTracked: true,
						requireSourceValid: false,
						requireTargetValid: true,
						allowClaimedSourceGap: true,
						allowClaimedTerminalPath: true,
					})
					if (
						!currentHive(movement).ensureMovementInvariant(movement, {
							expectedFrom: hop,
							warnLabel: '[conveyStep] Invalid movement after place',
							allowClaimedSourceGap: true,
						})
					) {
						throw new Error('Movement became invalid after place')
					}
				}

				const nextStorage = currentHive(movement).storageAt(hop)
				assert(nextStorage, 'nextStorage must be defined')
				currentHive(movement).noteMovementStorageCheckpoint(
					movement,
					'conveyStep.before-hop-alloc',
					hop
				)
				hopAlloc = movement.path.length
					? nextStorage.allocate(
							{ [movement.goodType]: 1 },
							{
								type: 'convey.hop',
								goodType: movement.goodType,
								movementId: movement._mgId,
								providerRef: movement.provider,
								demanderRef: movement.demander,
								providerName: movement.provider.name,
								demanderName: movement.demander.name,
								movement,
							}
						)
					: undefined

				moving = character.game.hex.looseGoods.add(from, movement.goodType, {
					position: from,
					available: false,
				})

				movementData.push({
					movement,
					hopAlloc,
					hop,
					from,
					moving,
				})
			} catch (error) {
				// When an intermediate storage is full, park the movement at its
				// previous coord instead of aborting. The movement stays alive and
				// another worker will retry when room opens up.
				if (
					sourceFulfilled &&
					movement.path.length > 0 &&
					movementData.length === 0 &&
					error instanceof Error &&
					error.message.includes('Insufficient room to allocate any goods')
				) {
					const blockedAt = movement.from
					const movementHive = currentHive(movement)
					const fromStorage = movementHive.storageAt(from)
					if (fromStorage) {
						try {
							movement.path.unshift(blockedAt)
							movement.from = from
							movement.place()
							const restored = fromStorage.addGood(movement.goodType, 1)
							assert(restored === 1, 'conveyStep.park: failed to restore good to from-storage')
							const newSource = fromStorage.reserve(
								{ [movement.goodType]: 1 },
								{
									type: 'convey.path',
									goodType: movement.goodType,
									movementId: movement._mgId,
									providerRef: movement.provider,
									demanderRef: movement.demander,
									providerName: movement.provider.name,
									demanderName: movement.demander.name,
									movement,
								}
							)
							movementHive.assignMovementSource(movement, newSource, 'conveyStep.park')
							movementHive.noteMovementLifecycle(movement, `conveyStep.parked:${from.q},${from.r}`)
							releaseMovementClaim(movement)
							console.warn('[conveyStep] Parked movement - intermediate storage full', {
								goodType: movement.goodType,
								provider: movement.provider.name,
								demander: movement.demander.name,
								parkedAt: `${from.q},${from.r}`,
								blockedAt: `${blockedAt.q},${blockedAt.r}`,
								blockedStorage: movementHive.storageAt(blockedAt)?.renderedGoods(),
							})
							movementHive.wakeWanderingWorkersNear(movement.provider, movement.demander)
							return waitStep()
						} catch {
							// Parking failed, fall through to normal cleanup
						}
					}
				}
				cleanupFailedConveyMovement(character, {
					movement,
					hopAlloc,
					from,
					moving,
					sourceFulfilled,
				} satisfies FailedConveyMovementData)
				for (const prev of movementData) cleanupFailedConveyMovement(character, prev)
				if (isRecoverableConveyError(error)) {
					const errorMessage = error instanceof Error ? error.message : String(error)
					console.warn('[conveyStep] Recovered from stale movement bookkeeping', {
						goodType: movement.goodType,
						provider: movement.provider.name,
						demander: movement.demander.name,
						error: errorMessage,
					})
					currentHive(movement).wakeWanderingWorkersNear(movement.provider, movement.demander)
					return waitStep()
				}
				throw error
			}
		}
		if (movementData.length === 0) {
			return waitStep()
		}

		const totalTime = getConveyDuration(character.vehicle.transferTime, movementData)

		// Create unified MultiMoveStep that animates all movements
		const description =
			movementData.length === 1 ? `convey.${movementData[0].movement.goodType}` : `convey.cycle`
		const visualMovements = getConveyVisualMovements(movementData)
		return new MultiMoveStep(totalTime, visualMovements, 'work', description)
			.canceled(() => {
				for (const { movement, hopAlloc, moving } of movementData) {
					if (!moving.isRemoved) moving.remove()
					if (!currentHive(movement).isMovementAlive(movement)) continue
					const movementHive = currentHive(movement)
					movementHive.noteMovementLifecycle(movement, 'conveyStep.canceled')
					releaseMovementClaim(movement)
					hopAlloc?.cancel()
					movementHive.cancelMovementSource(movement, 'conveyStep.canceled')
					movement.allocations.target.cancel()
					character.game.hex.looseGoods.add(character.tile, movement.goodType)
					movement.abort()
				}
			})
			.finished(() => {
				try {
					for (const { movement } of movementData) {
						if (!currentHive(movement).isMovementAlive(movement)) {
							throw new Error('Movement became invalid after hop handoff')
						}
					}
					for (const { movement, moving, hopAlloc, hop } of movementData) {
						const movementHive = currentHive(movement)
						const nextStorage = movementHive.storageAt(hop)

						if (!moving.isRemoved) moving.remove()
						if (!movement.path.length) {
							if (!movement.allocations?.target) {
								console.error('Target allocation missing for', movement)
								throw new Error('Target allocation missing')
							}
							releaseMovementClaim(movement)
							movementHive.noteMovementLifecycle(movement, 'conveyStep.finished.terminal')
							movement.finish()
						} else {
							if (!hopAlloc) {
								console.error('Hop allocation missing (but path exists) for', movement)
								throw new Error('Hop allocation missing')
							}

							hopAlloc.fulfill()
							movementHive.noteMovementLifecycle(
								movement,
								'conveyStep.finished.after-hop-alloc-fulfill'
							)
							movementHive.noteMovementStorageCheckpoint(
								movement,
								'conveyStep.finished.after-hop-alloc-fulfill.storage',
								hop
							)

							movementHive.noteMovementStorageCheckpoint(
								movement,
								'conveyStep.finished.before-hop-rebind',
								hop
							)
							const newSourceAlloc = nextStorage!.reserve(
								{ [movement.goodType]: 1 },
								{
									type: 'convey.path',
									goodType: movement.goodType,
									movementId: movement._mgId,
									providerRef: movement.provider,
									demanderRef: movement.demander,
									providerName: movement.provider.name,
									demanderName: movement.demander.name,
									movement,
								}
							)

							if (!newSourceAlloc) {
								console.error(
									'[conveyStep.finished] Failed to reserve storage for next hop:',
									movement.goodType
								)
								throw new Error('Failed to reserve storage for next hop')
							}

							movementHive.assignMovementSource(
								movement,
								newSourceAlloc,
								'conveyStep.finished.rebind'
							)
							currentHive(movement).assertMovementMine(movement, {
								label: 'conveyStep.after-hop-rebind.before-unclaim',
								expectedFrom: hop,
								expectClaimed: true,
								requireTracked: true,
								requireSourceValid: true,
								requireTargetValid: true,
								allowClaimedSourceGap: true,
								allowClaimedTerminalPath: true,
							})
							if (
								!currentHive(movement).ensureMovementInvariant(movement, {
									expectedFrom: hop,
									warnLabel: '[conveyStep] Invalid movement after hop handoff',
								})
							) {
								throw new Error('Movement became invalid after hop handoff')
							}
							releaseMovementClaim(movement)
							currentHive(movement).assertMovementMine(movement, {
								label: 'conveyStep.after-hop-handoff',
								expectedFrom: hop,
								expectClaimed: false,
								requireTracked: true,
								requireSourceValid: true,
								requireTargetValid: true,
							})
							currentHive(movement).wakeWanderingWorkersNear(movement.provider, movement.demander)
						}
					}
				} catch (error) {
					for (const { movement } of movementData) {
						currentHive(movement).noteMovementCaughtError(
							movement,
							'conveyStep.finished.catch',
							error
						)
					}
					for (const movement of movementData) cleanupFailedConveyMovement(character, movement)
					if (isRecoverableConveyError(error)) {
						const errorMessage = error instanceof Error ? error.message : String(error)
						console.warn('[conveyStep] Recovered from stale movement bookkeeping in finish', {
							error: errorMessage,
							movements: movementData.map(({ movement }) => ({
								goodType: movement.goodType,
								provider: movement.provider.name,
								demander: movement.demander.name,
							})),
						})
						for (const { movement } of movementData) {
							currentHive(movement).wakeWanderingWorkersNear(movement.provider, movement.demander)
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
		this[subject].game.notifyTerrainDepositsChanged(this[subject].tile)
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
			alveolus instanceof StorageAlveolus && alveolus.storage instanceof SlottedStorage,
			'assignedAlveolus must be a slotted StorageAlveolus'
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
