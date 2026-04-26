import { waitForIncomingGoodsPollSeconds } from 'engine-rules'
import { atomic } from 'mutts'
import { isTileCoord } from 'ssh/board/board'
import type { Alveolus } from 'ssh/board/content/alveolus'
import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { LooseGood } from 'ssh/board/looseGoods'
import type { Tile } from 'ssh/board/tile'
import { isBuildSite } from 'ssh/build-site'
import {
	constructionTargetFromProject,
	createConstructionSiteState,
	setConstructionConsumedGoods,
} from 'ssh/construction-state'
import { assert, traces } from 'ssh/debug'
import { alveolusClass } from 'ssh/hive'
import { BuildAlveolus } from 'ssh/hive/build'
import type { TrackedMovement } from 'ssh/hive/hive'
import { movementRefId } from 'ssh/hive/movement-ref'
import { StorageAlveolus } from 'ssh/hive/storage'
import type { TransformAlveolus } from 'ssh/hive/transform'
import type { Character } from 'ssh/population/character'
import type { AllocationBase } from 'ssh/storage'
import { SlottedStorage } from 'ssh/storage/slotted-storage'
import { contract, type Goods, type GoodType } from 'ssh/types'
import type { AxialCoord } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import { epsilon } from 'ssh/utils/varied'
import { subject } from '../scripts'
import { DurationStep, MultiMoveStep } from '../steps'
import type { WorkPlan } from '.'
import { getConveyDuration, getConveyVisualMovements, rebindConveyMovementRows } from './convey'
import { cleanupFailedConveyMovement, type FailedConveyMovementData } from './convey-cleanup'
import { ConveyStaleBookkeepingError, isConveyRollbackableError } from './convey-errors'

function applyConcreteTerrain(tile: Tile): void {
	tile.baseTerrain = 'concrete'
	tile.terrainState = {
		...(tile.terrainState ?? {}),
		terrain: 'concrete',
	}
	tile.game.upsertTerrainOverride(tile.position as { q: number; r: number }, {
		terrain: 'concrete',
	})
}

function finalizeBuildAlveolusToTarget(
	site: BuildAlveolus,
	TargetClass: new (tile: Tile) => Alveolus
) {
	applyConcreteTerrain(site.tile)
	site.tile.content = new TargetClass(site.tile)
}

function finalizeBuildDwellingToBasicDwelling(site: BuildDwelling) {
	applyConcreteTerrain(site.tile)
	site.tile.content = new BasicDwelling(site.tile)
	traces.residential.log?.('[residential] dwelling complete', {
		q: toAxialCoord(site.tile.position)?.q,
		r: toAxialCoord(site.tile.position)?.r,
		tier: site.targetTier,
	})
}

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

class ConstructionDurationStep extends DurationStep {
	constructor(
		duration: number,
		description: string,
		private readonly onProgress: (evolution: number) => void
	) {
		super(duration, 'work', description)
	}

	override evolve(evolution: number, dt: number): void {
		super.evolve(evolution, dt)
		this.onProgress(evolution)
	}
}

class WorkFunctions {
	declare [subject]: Character
	@contract('WorkPlan')
	prepare(workPlan: WorkPlan) {
		if (['convey', 'vehicleOffload'].includes(workPlan.job)) return
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
			assert(hive, `conveyStep: provider hive missing for ref#${movementRefId(movement.ref)}`)
			assert(
				movement.demander.hive === hive,
				`conveyStep: provider/demander hive mismatch for ref#${movementRefId(movement.ref)}`
			)
			return hive
		}
		const claimMovement = (movement: TrackedMovement) => {
			assert(
				!movement.claimed,
				`claimMovement: movement already claimed ref#${movementRefId(movement.ref)}`
			)
			assert(
				!movement.claimedBy,
				`claimMovement: movement already has claimedBy ref#${movementRefId(movement.ref)}`
			)
			assert(
				!movement.claimedAtMs,
				`claimMovement: movement already has claimedAtMs ref#${movementRefId(movement.ref)}`
			)
			movement.claimed = true
			movement.claimedBy = character
			movement.claimedAtMs = Date.now()
			movement.provider.hive.noteMovementLifecycle(movement, `movement.claimed.by:${character.uid}`)
		}
		const releaseMovementClaim = (movement: TrackedMovement) => {
			assert(
				movement.claimed,
				`releaseMovementClaim: movement not claimed ref#${movementRefId(movement.ref)}`
			)
			assert(
				movement.claimedBy === character,
				`releaseMovementClaim: movement claimed by ${movement.claimedBy?.uid ?? 'nobody'} not ${character.uid}`
			)
			assert(
				!!movement.claimedAtMs,
				`releaseMovementClaim: movement missing claimedAtMs ref#${movementRefId(movement.ref)}`
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
		const isCycleResolution = movements.length >= 2

		const movementData: MovementData[] = []
		let cycleLeaderHandled = false

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
				assert(movement.path.length > 0, 'conveyStep: empty movement path')
				const nextCoord = movement.path[0]!
				const terminalHop = movement.path.length === 1 && isTileCoord(nextCoord)
				const skipPreflight = isCycleResolution && !cycleLeaderHandled && !terminalHop

				if (!terminalHop && !skipPreflight) {
					const nextStorage = movementHive.storageAt(nextCoord)
					assert(nextStorage, 'nextStorage must be defined')
					movementHive.noteMovementStorageCheckpoint(
						movement,
						'conveyStep.before-hop-alloc',
						nextCoord
					)
					hopAlloc = nextStorage.allocate(
						{ [movement.goodType]: 1 },
						{
							type: 'convey.hop',
							goodType: movement.goodType,
							movementRef: movement.ref,
							providerRef: movement.provider,
							demanderRef: movement.demander,
							providerName: movement.provider.name,
							demanderName: movement.demander.name,
							movement,
						}
					)
				}
				if (skipPreflight) cycleLeaderHandled = true

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

				const hop = movement.hop()!

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
						throw new ConveyStaleBookkeepingError('Movement became invalid after place')
					}
				}

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
				cleanupFailedConveyMovement(character, {
					movement,
					hopAlloc,
					from,
					moving,
					sourceFulfilled,
				} satisfies FailedConveyMovementData)
				for (const prev of movementData) cleanupFailedConveyMovement(character, prev)
				if (isConveyRollbackableError(error)) {
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

		if (!rebindConveyMovementRows(movementData)) {
			for (const row of movementData) {
				cleanupFailedConveyMovement(character, {
					movement: row.movement,
					hopAlloc: row.hopAlloc,
					from: row.from,
					moving: row.moving,
					sourceFulfilled: true,
				} satisfies FailedConveyMovementData)
			}
			for (const { movement } of movementData) {
				currentHive(movement).wakeWanderingWorkersNear(movement.provider, movement.demander)
			}
			return waitStep()
		}

		const totalTime = getConveyDuration(character.freightTransferTime, movementData)

		// Create unified MultiMoveStep that animates all movements
		const description =
			movementData.length === 1 ? `convey.${movementData[0].movement.goodType}` : `convey.cycle`
		const visualMovements = getConveyVisualMovements(movementData)
		const conveyStepRef: { step?: MultiMoveStep } = {}
		const step = new MultiMoveStep(totalTime, visualMovements, 'work', description, () => {
			if (!rebindConveyMovementRows(movementData)) {
				conveyStepRef.step?.cancel()
			}
		})
		conveyStepRef.step = step
		return step
			.canceled(() => {
				rebindConveyMovementRows(movementData)
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
					if (!rebindConveyMovementRows(movementData)) {
						throw new ConveyStaleBookkeepingError('Movement became invalid after hop handoff')
					}
					for (const { movement, moving, hopAlloc: rawHopAlloc, hop } of movementData) {
						const movementHive = currentHive(movement)
						const nextStorage = movementHive.storageAt(hop)

						if (!moving.isRemoved) moving.remove()
						if (!movement.path.length) {
							if (!movement.allocations?.target) {
								console.error('Target allocation missing for', movement)
								throw new ConveyStaleBookkeepingError('Target allocation missing')
							}
							releaseMovementClaim(movement)
							movementHive.noteMovementLifecycle(movement, 'conveyStep.finished.terminal')
							movement.finish()
						} else {
							let hopAlloc = rawHopAlloc
							if (!hopAlloc) {
								assert(nextStorage, 'nextStorage must be defined for deferred cycle-leader alloc')
								hopAlloc = nextStorage.allocate(
									{ [movement.goodType]: 1 },
									{
										type: 'convey.hop',
										goodType: movement.goodType,
										movementRef: movement.ref,
										providerRef: movement.provider,
										demanderRef: movement.demander,
										providerName: movement.provider.name,
										demanderName: movement.demander.name,
										movement,
									}
								)
								movementHive.noteMovementLifecycle(
									movement,
									'conveyStep.finished.deferred-cycle-leader-alloc'
								)
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
									movementRef: movement.ref,
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
								throw new ConveyStaleBookkeepingError('Failed to reserve storage for next hop')
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
								throw new ConveyStaleBookkeepingError('Movement became invalid after hop handoff')
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
					rebindConveyMovementRows(movementData)
					for (const { movement } of movementData) {
						currentHive(movement).noteMovementCaughtError(
							movement,
							'conveyStep.finished.catch',
							error
						)
					}
					for (const movement of movementData) cleanupFailedConveyMovement(character, movement)
					if (isConveyRollbackableError(error)) {
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
		deposit.amount -= 1
		if (deposit.amount <= 0) unbuiltLand.deposit = undefined
		this[subject].game.notifyTerrainDepositsChanged(this[subject].tile)
		return new DurationStep(
			this[subject].assignedAlveolus!.workTime,
			'work',
			`harvest.${this[subject].assignedAlveolus!.name}`
		).finished(() => {
			const character = this[subject]
			const { game, tile } = character
			for (const [goodType, qty] of Object.entries(alveolus.action.output) as [
				GoodType,
				number,
			][]) {
				let remaining = qty
				while (remaining > epsilon) {
					const chunk = remaining >= 1 ? 1 : remaining
					// Omit `position` in options so loose good uses `tile.position` (character.position
					// can be fine-grained and fail looseGoods.add's axial proximity assert).
					game.hex.looseGoods.add(tile, goodType)
					remaining -= chunk
				}
			}
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
		return new DurationStep(character.freightTransferTime, 'work', `defragment.${alveolus.name}`)
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
		const project = content.project
		// Redundant assert for TS narrowing, or just cast
		// assert(content instanceof UnBuiltLand, 'Tile must be UnBuiltLand')
		// assert(content.project, 'UnBuiltLand must have a project')
		const target = constructionTargetFromProject(project)
		assert(target, 'UnBuiltLand project must map to a construction target')

		const constructionSite = content.constructionSite ?? createConstructionSiteState(target)

		content.constructionSite = constructionSite
		constructionSite.phase = 'foundation'
		return new DurationStep(3, 'work', 'foundation').finished(() => {
			if (target.kind === 'alveolus') {
				content.tile.content = new BuildAlveolus(
					content.tile,
					target.alveolusType,
					constructionSite
				)
			} else {
				applyConcreteTerrain(content.tile)
				content.tile.content = new BuildDwelling(content.tile, target.tier, constructionSite)
				const ac = toAxialCoord(content.tile.position)
				traces.residential.log?.('[residential] foundation -> BuildDwelling', {
					tier: target.tier,
					q: ac?.q,
					r: ac?.r,
				})
			}
		})
	}

	@contract()
	constructionStep() {
		// Character must already be on the construction site tile
		const content = this[subject].tile.content
		if (isBuildSite(content)) {
			const site = content
			assert(site.isReady, 'Construction site must be ready')
			const totalSeconds = site.constructionSite.recipe.workSeconds
			const remaining = Math.max(0, totalSeconds - site.constructionWorkSecondsApplied)
			const stepDescription =
				site instanceof BuildAlveolus
					? `construct.${String(site.target)}`
					: `construct.dwelling.${site.targetTier}`
			const finalize = () => {
				setConstructionConsumedGoods(site.constructionSite, site.constructionSite.requiredGoods)
				if (site instanceof BuildAlveolus) {
					const targetType = site.target as keyof typeof alveolusClass
					const TargetClass = alveolusClass[targetType]
					assert(TargetClass, 'Target alveolus class must exist')
					finalizeBuildAlveolusToTarget(site, TargetClass)
				} else if (site instanceof BuildDwelling) {
					finalizeBuildDwellingToBasicDwelling(site)
				} else {
					assert(false, 'BuildSite must resolve to BuildAlveolus or BuildDwelling')
				}
			}
			if (remaining <= 0) {
				site.constructionSite.phase = 'building'
				site.constructionSite.workSecondsApplied = totalSeconds
				site.constructionWorkSecondsApplied = totalSeconds
				finalize()
				return
			}
			site.constructionSite.phase = 'building'
			const baselineApplied = site.constructionWorkSecondsApplied
			const step = new ConstructionDurationStep(remaining, stepDescription, (evolution) => {
				site.constructionSite.workSecondsApplied = baselineApplied + evolution * remaining
			})
			return step
				.finished(() => {
					site.constructionWorkSecondsApplied = totalSeconds
					site.constructionSite.workSecondsApplied = totalSeconds
					finalize()
				})
				.canceled(() => {
					const progressFraction = Math.min(1, Math.max(0, step.evolution))
					site.constructionWorkSecondsApplied += progressFraction * remaining
					site.constructionSite.workSecondsApplied = site.constructionWorkSecondsApplied
					site.constructionSite.phase = 'waiting_construction'
				})
		}
		assert(false, 'Tile must be a BuildAlveolus or BuildDwelling')
	}
}

export { WorkFunctions }
