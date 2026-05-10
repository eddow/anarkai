import { waitForIncomingGoodsPollSeconds } from 'engine-rules'
import { atomic } from 'mutts'
import { isTileCoord } from 'ssh/board/board'
import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { LooseGood } from 'ssh/board/looseGoods'
import type { Tile } from 'ssh/board/tile'
import { isBuildSite } from 'ssh/build-site'
import { Commitment } from 'ssh/commitment'
import {
	constructionTargetFromProject,
	createConstructionSiteState,
	setConstructionConsumedGoods,
} from 'ssh/construction-state'
import { assert, traces } from 'ssh/dev/debug'
import { createAlveolus } from 'ssh/hive'
import { BuildAlveolus } from 'ssh/hive/build'
import { commitmentValid, type TrackedMovement } from 'ssh/hive/hive'
import { movementRefId } from 'ssh/hive/movement-ref'
import { MovementState, transitionMovement } from 'ssh/hive/movement-state'
import { StorageAlveolus } from 'ssh/hive/storage'
import type { TransformAlveolus } from 'ssh/hive/transform'
import type { Character } from 'ssh/population/character'
import type { Storage } from 'ssh/storage'
import { SlottedStorage } from 'ssh/storage/slotted-storage'
import { contract, type Goods, type GoodType } from 'ssh/types'
import { type AxialCoord, axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import { epsilon } from 'ssh/utils/varied'
import { subject } from '../scripts'
import { DurationStep, MultiMoveStep } from '../steps'
import type { WorkPlan } from '.'
import { getConveyDuration, getConveyVisualMovements, rebindConveyMovementRows } from './convey'
import { cleanupFailedConveyMovement, type FailedConveyMovementData } from './convey-cleanup'
import { ConveyStaleBookkeepingError } from './convey-errors'

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

function finalizeBuildAlveolusToTarget(site: BuildAlveolus) {
	applyConcreteTerrain(site.tile)
	const alveolus = createAlveolus(site.target, site.tile)
	assert(alveolus, 'Target alveolus must exist')
	site.tile.content = alveolus
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
 * - `moving` is the transient loose-good used for the visual in-transit representation.
 *
 * Hop storage allocation is deferred to the step's `onFulfilled` callback.
 * This avoids holding capacity at the next hop during transit and eliminates
 * the need for a separate hop Commitment object — the step itself (which extends
 * Commitment) serves as the allocation commitment.
 */
interface MovementData {
	movement: TrackedMovement
	hop: AxialCoord
	from: AxialCoord
	moving: LooseGood
	sourceFulfilled?: boolean
}

function waitStep() {
	return new DurationStep(waitForIncomingGoodsPollSeconds, 'idle', 'waitForIncomingGoods')
}

function storageTrace(storage: Storage | undefined, goodType: GoodType) {
	if (!storage) return undefined
	return {
		stock: storage.stock[goodType] ?? 0,
		available: storage.available(goodType),
		allocated: storage.allocated(goodType),
		virtualGoodsCount: storage.virtualGoodsCount,
		slots: storage
			.renderedGoods()
			.slots.filter(
				(slot) =>
					slot.goodType === goodType ||
					(slot.present === 0 && slot.reserved === 0 && slot.allocated === 0)
			)
			.map((slot) => ({
				goodType: slot.goodType,
				present: slot.present,
				reserved: slot.reserved,
				allocated: slot.allocated,
				allowed: slot.allowed,
			})),
	}
}

function commitmentTrace(commitment: Commitment | undefined) {
	return {
		label: commitment?.label,
		traceId: commitment?.traceId,
		ended: commitment?.ended,
		valid: commitmentValid(commitment),
		reason: (commitment as (Commitment & { reason?: unknown }) | undefined)?.reason,
	}
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

	@contract('WorkPlan?')
	myNextJob(workPlan?: WorkPlan) {
		const target = workPlan?.target
		const alveolus =
			target && 'getJob' in target && typeof target.getJob === 'function'
				? target
				: this[subject].assignedAlveolus
		assert(alveolus, 'assignedAlveolus must be set')
		assert(
			'getJob' in alveolus && typeof alveolus.getJob === 'function',
			'alveolus must have getJob method'
		)
		return alveolus.getJob(this[subject])
	}

	@contract('string?')
	isOnDeposit(depositName?: string) {
		const content = this[subject].tile.content
		return content instanceof UnBuiltLand && content.deposit?.name === depositName
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
			movement._state = transitionMovement(movement._state, MovementState.claimed)
			movement.provider.hive.noteMovementLifecycle(movement, `movement.claimed.by:${character.uid}`)
			traces.convey.log?.(
				`[conveyStep] claimed ${movement.goodType} ref#${movementRefId(movement.ref)} by=${character.uid}`,
				{
					character: character.uid,
					alveolus: character.assignedAlveolus?.name,
					goodType: movement.goodType,
					movementRef: movementRefId(movement.ref),
					from: axial.key(movement.from),
					next: movement.path[0] ? axial.key(movement.path[0]) : undefined,
					pathLength: movement.path.length,
				}
			)
		}
		const releaseMovementClaim = (movement: TrackedMovement) => {
			assert(
				movement.claimed,
				`releaseMovementClaim: movement not claimed ref#${movementRefId(movement.ref)}`
			)
			assert(
				movement.claimedBy?.uid === character.uid,
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
			movement._state = transitionMovement(movement._state, MovementState.tracked)
			movement.claimed = false
			delete movement.claimedBy
			delete movement.claimedAtMs
			traces.convey.log?.(
				`[conveyStep] released ${movement.goodType} ref#${movementRefId(movement.ref)} by=${character.uid}`,
				{
					character: character.uid,
					alveolus: character.assignedAlveolus?.name,
					goodType: movement.goodType,
					movementRef: movementRefId(movement.ref),
					from: axial.key(movement.from),
					pathLength: movement.path.length,
				}
			)
		}
		const alveolus = character.assignedAlveolus
		if (!alveolus) {
			traces.convey.warn?.('[conveyStep] skipped: assignedAlveolus missing', {
				character: character.uid,
				tile: toAxialCoord(character.tile.position),
				actionDescription: character.actionDescription,
			})
			return undefined
		}
		const characterCoord = toAxialCoord(character.tile.position)
		const assignedCoord = toAxialCoord(alveolus.tile.position)
		const onAssignedTile = axial.key(characterCoord) === axial.key(assignedCoord)
		const adjacentToAssignedTile = axial.distance(characterCoord, assignedCoord) <= 1
		assert(
			onAssignedTile || adjacentToAssignedTile,
			'Character must be on or adjacent to the assigned convey alveolus'
		)
		// Get movement(s) - either a single movement or a cycle
		const movements = alveolus.aGoodMovement
		if (!movements || movements.length === 0) {
			traces.convey.log?.(`[conveyStep] no movement for ${alveolus.name}`, {
				character: character.uid,
				alveolus: alveolus.name,
				incomingGoods: alveolus.incomingGoods,
			})
			return alveolus.incomingGoods ? waitStep() : undefined
		}

		const hive = alveolus.hive
		const movementData: MovementData[] = []
		traces.convey.log?.(`[conveyStep] start ${movements.length} movement(s) at ${alveolus.name}`, {
			character: character.uid,
			alveolus: alveolus.name,
			movements: movements.map(({ movement, fromSnapshot }) => ({
				goodType: movement.goodType,
				movementRef: movementRefId(movement.ref),
				from: axial.key(fromSnapshot),
				next: movement.path[0] ? axial.key(movement.path[0]) : undefined,
				pathLength: movement.path.length,
			})),
		})

		for (const selection of movements) {
			const movement = selection.movement
			const from = selection.fromSnapshot
			let sourceFulfilled = false
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
				const sourceReason = (
					movement.allocations.source as
						| (typeof movement.allocations.source & { reason?: { type?: string } })
						| undefined
				)?.reason
				if (!isTileCoord(from)) {
					const sourceStorage = movementHive.storageAt(from)
					assert(sourceStorage, 'conveyStep: border source storage must exist')
					if (
						sourceReason?.type !== 'convey.path' ||
						sourceStorage.available(movement.goodType) > 0
					) {
						if (
							!movementHive.bindMovementSourceToTransitStorage(
								movement,
								sourceStorage,
								'conveyStep.before-claim.border-source'
							)
						) {
							throw new ConveyStaleBookkeepingError('Border source rebind failed before claim')
						}
					}
				}
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

				movementHive.noteMovementStorageCheckpoint(
					movement,
					'conveyStep.before-source-fulfill.storage',
					from
				)
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
					requireSourceValid: true,
					requireTargetValid: true,
					allowClaimedTerminalPath: true,
					allowUntracked: true,
				})

				const hop = movement.hop()!
				traces.convey.log?.(
					`[conveyStep] hop prepared ${movement.goodType} ref#${movementRefId(movement.ref)} ${axial.key(from)} -> ${axial.key(hop)} remaining=${movement.path.length}`,
					{
						character: character.uid,
						goodType: movement.goodType,
						movementRef: movementRefId(movement.ref),
						from: axial.key(from),
						hop: axial.key(hop),
						remainingPathLength: movement.path.length,
					}
				)

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
						requireSourceValid: true,
						requireTargetValid: true,
						allowClaimedTerminalPath: true,
					})
					traces.convey.log?.(
						`[conveyStep] placed intermediate ${movement.goodType} ref#${movementRefId(movement.ref)} at=${axial.key(hop)}`,
						{
							character: character.uid,
							goodType: movement.goodType,
							movementRef: movementRefId(movement.ref),
							at: axial.key(hop),
							remainingPathLength: movement.path.length,
						}
					)
					if (
						!currentHive(movement).ensureMovementInvariant(movement, {
							expectedFrom: hop,
							warnLabel: '[conveyStep] Invalid movement after place',
						})
					) {
						throw new ConveyStaleBookkeepingError('Movement became invalid after place')
					}
				}

				moving = character.game.hex.looseGoods.add(from, movement.goodType, {
					position: from,
					available: false,
				})
				traces.convey.log?.(
					`[conveyStep] visual good ${movement.goodType} ref#${movementRefId(movement.ref)} from=${axial.key(from)} to=${axial.key(hop)}`,
					{
						character: character.uid,
						goodType: movement.goodType,
						movementRef: movementRefId(movement.ref),
						from: axial.key(from),
						hop: axial.key(hop),
					}
				)

				movementData.push({
					movement,
					hop,
					from,
					moving,
					sourceFulfilled,
				})
			} catch (error) {
				cleanupFailedConveyMovement(character, {
					movement,
					from,
					moving,
					sourceFulfilled,
				} satisfies FailedConveyMovementData)
				for (const prev of movementData) cleanupFailedConveyMovement(character, prev)
				throw error
			}
		}
		if (movementData.length === 0) {
			traces.convey.log?.(`[conveyStep] no valid movement data for ${alveolus.name}`, {
				character: character.uid,
				alveolus: alveolus.name,
			})
			return waitStep()
		}

		if (!rebindConveyMovementRows(movementData)) {
			for (const row of movementData) {
				cleanupFailedConveyMovement(character, {
					movement: row.movement,
					from: row.from,
					moving: row.moving,
					sourceFulfilled: true,
				} satisfies FailedConveyMovementData)
			}
			for (const { movement } of movementData) {
				currentHive(movement).wakeWanderingWorkersNear(movement.provider, movement.demander)
			}
			throw new ConveyStaleBookkeepingError('Movement became invalid before convey animation')
		}

		const totalTime = getConveyDuration(character.freightTransferTime, movementData)
		traces.convey.log?.(`[conveyStep] animate ${movementData.length} movement(s)`, {
			character: character.uid,
			totalTime,
			deferFirstTick: true,
			movements: movementData.map(({ movement, from, hop }) => ({
				goodType: movement.goodType,
				movementRef: movementRefId(movement.ref),
				from: axial.key(from),
				hop: axial.key(hop),
				hopDistance: axial.distance(from, hop),
				hopDuration:
					character.freightTransferTime *
					Math.max(1, axial.distance(from, hop)) *
					movementData.length,
				remainingPathLength: movement.path.length,
			})),
		})

		// Create unified MultiMoveStep that animates all movements
		const description =
			movementData.length === 1 ? `convey.${movementData[0].movement.goodType}` : `convey.cycle`
		const visualMovements = getConveyVisualMovements(movementData)
		const conveyStepRef: { step?: MultiMoveStep } = {}
		const step = new MultiMoveStep(totalTime, visualMovements, 'work', description, () => {
			if (!rebindConveyMovementRows(movementData)) {
				conveyStepRef.step?.cancel('stale-rebind')
			}
		}, true, true)
		conveyStepRef.step = step
		for (const { movement, hop } of movementData) {
			if (!movement.path.length) continue
			const movementHive = currentHive(movement)
			const nextStorage = movementHive.storageAt(hop)
			assert(nextStorage, 'nextStorage must be defined for intermediate hop')
			const hopResult = nextStorage.allocate({ [movement.goodType]: 1 }, step)
			if (hopResult !== undefined) {
				traces.convey.warn?.(
					`[conveyStep] hop allocation refused ${movement.goodType} ref#${movementRefId(movement.ref)} at=${axial.key(hop)} reason=${hopResult}`,
					{
						character: character.uid,
						goodType: movement.goodType,
						movementRef: movementRefId(movement.ref),
						hop: axial.key(hop),
						reason: hopResult,
					}
				)
				for (const row of movementData) cleanupFailedConveyMovement(character, row)
				movementHive.wakeWanderingWorkersNear(movement.provider, movement.demander)
				return waitStep()
			}
			movementHive.noteMovementLifecycle(movement, 'conveyStep.after-step-hop-alloc')
			movementHive.noteMovementStorageCheckpoint(
				movement,
				'conveyStep.after-step-hop-alloc.storage',
				hop
			)
		}
		const stepHive = currentHive(movementData[0]!.movement)
		try {
			stepHive.bindMovementsSourceToHopStep(
				movementData.map(({ movement }) => movement),
				step,
				'conveyStep.pickup-hop-step'
			)
			for (const row of movementData) {
				row.sourceFulfilled = true
				currentHive(row.movement).noteMovementLifecycle(
					row.movement,
					'conveyStep.after-hop-source-bind'
				)
				currentHive(row.movement).assertMovementMine(row.movement, {
					label: 'conveyStep.after-hop-source-bind',
					expectedFrom: row.hop,
					expectClaimed: true,
					requireTracked: !!row.movement.path.length,
					requireSourceValid: true,
					requireTargetValid: true,
					allowClaimedTerminalPath: true,
					allowUntracked: !row.movement.path.length,
				})
			}
		} catch (error) {
			for (const row of movementData) cleanupFailedConveyMovement(character, row)
			throw error
		}
		return step
			.onCancelled(() => {
				rebindConveyMovementRows(movementData)
				for (const { movement, moving } of movementData) {
					if (moving && !moving.isRemoved) moving.remove()
					if (!currentHive(movement).isMovementAlive(movement)) {
						continue
					}
					const movementHive = currentHive(movement)
					movementHive.noteMovementLifecycle(movement, 'conveyStep.canceled')
					releaseMovementClaim(movement)
					movementHive.cancelMovementSource(movement, 'conveyStep.canceled')
					movement.allocations.target.cancel('conveyStep.canceled')
					character.game.hex.looseGoods.add(character.tile, movement.goodType)
					movement.abort()
				}
			})
			.onFulfilled(() => {
				const hopAllocationFulfilled = new Set<TrackedMovement['ref']>()
				try {
					for (const { movement } of movementData) {
						if (movement.path.length) hopAllocationFulfilled.add(movement.ref)
					}
					traces.convey.log?.(`[conveyStep] fulfilled animation`, {
						character: character.uid,
						movements: movementData.map(({ movement, hop }) => ({
							goodType: movement.goodType,
							movementRef: movementRefId(movement.ref),
							hop: axial.key(hop),
							remainingPathLength: movement.path.length,
						})),
					})
					if (!rebindConveyMovementRows(movementData)) {
						throw new ConveyStaleBookkeepingError('Movement became invalid after hop handoff')
					}
					for (const row of movementData) {
						const { movement, moving, hop } = row
						const movementHive = currentHive(movement)
						const nextStorage = movementHive.storageAt(hop)

						if (!moving.isRemoved) moving.remove()
						if (!movement.path.length) {
							if (!movement.allocations?.target) {
								console.error('Target allocation missing for', movement)
								throw new ConveyStaleBookkeepingError('Target allocation missing')
							}
							const demanderStorage = movement.demander.storage
							traces.convey.log?.('[conveyStep.terminal.before-source-fulfill]', {
								character: character.uid,
								goodType: movement.goodType,
								movementRef: movementRefId(movement.ref),
								at: axial.key(hop),
								source: commitmentTrace(movement.allocations.source),
								target: commitmentTrace(movement.allocations.target),
								demander: movement.demander.name,
								demanderStorage: storageTrace(demanderStorage, movement.goodType),
							})
							// Fulfill source allocation BEFORE releasing claim to prevent border transit
							// invariant failures during reactive updates. The claim release triggers
							// aGoodMovement → assertBorderTransitStorageInvariant, which would find stock
							// at the border from the unfulfilled hive-transfer source allocation.
							movementHive.fulfillMovementSource(movement, 'conveyStep.finished.pre-release')
							traces.convey.log?.('[conveyStep.terminal.after-source-fulfill]', {
								character: character.uid,
								goodType: movement.goodType,
								movementRef: movementRefId(movement.ref),
								at: axial.key(hop),
								source: commitmentTrace(movement.allocations.source),
								target: commitmentTrace(movement.allocations.target),
								demander: movement.demander.name,
								demanderStorage: storageTrace(demanderStorage, movement.goodType),
							})
							releaseMovementClaim(movement)
							movementHive.noteMovementLifecycle(movement, 'conveyStep.finished.terminal')
							traces.convey.log?.('[conveyStep.terminal.before-finish]', {
								character: character.uid,
								goodType: movement.goodType,
								movementRef: movementRefId(movement.ref),
								at: axial.key(hop),
								source: commitmentTrace(movement.allocations.source),
								target: commitmentTrace(movement.allocations.target),
								demander: movement.demander.name,
								demanderStorage: storageTrace(demanderStorage, movement.goodType),
							})
							movement.finish()
							traces.convey.log?.('[conveyStep.terminal.after-finish]', {
								character: character.uid,
								goodType: movement.goodType,
								movementRef: movementRefId(movement.ref),
								at: axial.key(hop),
								source: commitmentTrace(movement.allocations.source),
								target: commitmentTrace(movement.allocations.target),
								demander: movement.demander.name,
								demanderStorage: storageTrace(demanderStorage, movement.goodType),
							})
							traces.convey.log?.(
								`[conveyStep] terminal finished ${movement.goodType} ref#${movementRefId(movement.ref)} at=${axial.key(hop)}`,
								{
									character: character.uid,
									goodType: movement.goodType,
									movementRef: movementRefId(movement.ref),
									at: axial.key(hop),
								}
							)
						} else {
							assert(nextStorage, 'nextStorage must be defined for intermediate hop')
							movementHive.noteMovementStorageCheckpoint(
								movement,
								'conveyStep.finished.before-hop-rebind',
								hop
							)
							if (
								!movementHive.bindMovementSourceToTransitStorage(
									movement,
									nextStorage,
									'conveyStep.finished.rebind'
								)
							) {
								throw new ConveyStaleBookkeepingError('Reserve for next hop failed')
							}
							row.sourceFulfilled = true
							movementHive.assertBorderTransitStorageInvariant('[conveyStep.finished.rebind]')
							traces.convey.log?.(
								`[conveyStep] rebound source ${movement.goodType} ref#${movementRefId(movement.ref)} at=${axial.key(hop)} remaining=${movement.path.length}`,
								{
									character: character.uid,
									goodType: movement.goodType,
									movementRef: movementRefId(movement.ref),
									at: axial.key(hop),
									remainingPathLength: movement.path.length,
								}
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
					for (const { movement } of movementData) {
						currentHive(movement).assertBorderTransitStorageInvariant('[conveyStep.finished]')
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
					for (const movement of movementData) {
						cleanupFailedConveyMovement(character, {
							...movement,
							hopAllocationFulfilled: hopAllocationFulfilled.has(movement.movement.ref),
						})
					}
					console.error('[conveyStep] Error in finished callback:', error)
					throw error
				}
			})
			.onFinal(() => {
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
		).onFulfilled(() => {
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
		const inputCommitment = new Commitment(`transform.input.${alveolus.name}`)
		const inputResult = alveolus.storage.reserve(action.inputs as Goods, inputCommitment)
		if (inputResult !== undefined) {
			console.error('[transformStep] Failed to reserve inputs:', inputResult)
			return waitStep()
		}

		const outputCommitment = new Commitment(`transform.output.${alveolus.name}`)
		const outputResult = alveolus.storage.allocate(action.output as Goods, outputCommitment)
		if (outputResult !== undefined) {
			console.error('[transformStep] Failed to allocate outputs:', outputResult)
			inputCommitment.cancel('transform.output.failed')
			return waitStep()
		}

		return new DurationStep(alveolus.workTime, 'work', `transform.${alveolus.name}`)
			.onFulfilled(() => {
				inputCommitment.fulfill()
				outputCommitment.fulfill()
			})
			.onCancelled(() => {
				inputCommitment.cancel('transform.cancelled')
				outputCommitment.cancel('transform.cancelled')
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
		const takeCommitment = new Commitment(`defragment.take.${alveolus.name}`)
		const takeResult = alveolus.storage.allocate({ [fragmentedGoodType]: 1 }, takeCommitment)
		if (takeResult !== undefined) {
			console.error('[defragmentStep] Failed to allocate take:', takeResult)
			takeCommitment.cancel('defragment.take.failed')
			return
		}
		const arrangeCommitment = new Commitment(`defragment.arrange.${alveolus.name}`)
		const arrangeResult = alveolus.storage.reserve({ [fragmentedGoodType]: 1 }, arrangeCommitment)
		if (arrangeResult !== undefined) {
			console.error('[defragmentStep] Failed to reserve arrange:', arrangeResult)
			takeCommitment.cancel('defragment.arrange.failed')
			arrangeCommitment.cancel('defragment.arrange.failed')
			return
		}
		return new DurationStep(character.freightTransferTime, 'work', `defragment.${alveolus.name}`)
			.onFulfilled(() => {
				takeCommitment.fulfill()
				arrangeCommitment.fulfill()
			})
			.onCancelled(() => {
				takeCommitment.cancel('defragment.cancelled')
				arrangeCommitment.cancel('defragment.cancelled')
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
		return new DurationStep(3, 'work', 'foundation').onFulfilled(() => {
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
					finalizeBuildAlveolusToTarget(site)
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
				.onFulfilled(() => {
					site.constructionWorkSecondsApplied = totalSeconds
					site.constructionSite.workSecondsApplied = totalSeconds
					finalize()
				})
				.onCancelled(() => {
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
