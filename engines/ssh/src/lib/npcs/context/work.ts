import { waitForIncomingGoodsPollSeconds } from 'engine-rules'
import { atomic } from 'mutts'
import { isTileCoord } from 'ssh/board/board'
import {
	harvestMaturePlantedTree,
	hasMaturePlantedTree,
	normalizePlantedTrees,
	plantedTreeWoodYield,
	UnBuiltLand,
} from 'ssh/board/content/unbuilt-land'
import type { LooseGood } from 'ssh/board/looseGoods'
import { isConstructionSiteShell } from 'ssh/build-site'
import { Commitment } from 'ssh/commitment'
import {
	applyConstructionConcreteTerrain,
	constructionShellStepDescription,
	createConstructionShell,
	finalizeConstructionShell,
} from 'ssh/construction-shell'
import {
	constructionTargetFromProject,
	createConstructionSiteState,
	foundationGoodsComplete,
	setConstructionFoundationConsumedGoods,
	setConstructionFoundationDeliveredGoods,
} from 'ssh/construction-state'
import { assert, traces } from 'ssh/dev/debug'
import { ForesterAlveolus } from 'ssh/hive/forester'
import { commitmentValid, type TrackedMovement } from 'ssh/hive/hive'
import { movementRefId } from 'ssh/hive/movement-ref'
import { MovementState, transitionMovement } from 'ssh/hive/movement-state'
import { StorageAlveolus } from 'ssh/hive/storage'
import { TransformAlveolus } from 'ssh/hive/transform'
import type { Character } from 'ssh/population/character'
import type { Storage } from 'ssh/storage'
import { SlottedStorage } from 'ssh/storage/slotted-storage'
import { contract, type GoodType } from 'ssh/types'
import { type AxialCoord, axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import { epsilon } from 'ssh/utils/varied'
import { subject } from '../scripts'
import { AEvolutionStep, DurationStep, MoveToStep, MultiMoveStep, type TextKey } from '../steps'
import type { WorkPlan } from '.'
import { getConveyDuration, getConveyVisualMovements, rebindConveyMovementRows } from './convey'
import { cleanupFailedConveyMovement, type FailedConveyMovementData } from './convey-cleanup'
import { ConveyStaleBookkeepingError } from './convey-errors'

/**
 * Runtime snapshot for a single convey sub-movement.
 *
 * - `movement` is the authoritative transfer token tracked by the hive.
 * - `from` is the origin snapshot captured before `movement.hop()` mutates `movement.from`.
 * - `hop` is the coordinate reached by this step.
 * - `moving` is the transient loose-good used for the visual in-transit representation.
 *
 * Destination capacity is held by the animation step, but the movement keeps its
 * original source reservation until the animation fulfills. That keeps freight
 * from leaving storage before the carrier actually completes the carry.
 */
interface MovementData {
	movement: TrackedMovement
	hop: AxialCoord
	from: AxialCoord
	moving: LooseGood
	sourceFulfilled?: boolean
}

function waitStep() {
	return new DurationStep(waitForIncomingGoodsPollSeconds, 'idle', 'waitForIncomingGoods', {
		key: 'waitForIncomingGoods',
	})
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

/**
 * Publish tile-endpoint notifications for a hop that has already committed.
 *
 * Convey can travel through border storage, but the first consumer for this event
 * is vehicle/tile presentation. Border endpoints are skipped here so v1 consumers
 * only receive owners they can resolve through the normal tile visual/entity maps.
 * The function is called after the source/target storage bookkeeping has succeeded;
 * failed or cancelled hops must stay silent.
 */
function enqueueConveyedHopEvents(
	character: Character,
	movement: TrackedMovement,
	from: AxialCoord,
	hop: AxialCoord
) {
	const sourceTile = isTileCoord(from) ? character.game.hex.getTile(from) : undefined
	const targetTile = isTileCoord(hop) ? character.game.hex.getTile(hop) : undefined
	const base = {
		goodType: movement.goodType,
		movementRef: movementRefId(movement.ref),
		characterUid: character.uid,
		from,
		to: hop,
	}
	if (sourceTile) {
		character.game.enqueueConveyEvent({
			...base,
			ownerUid: sourceTile.uid,
			endpoint: 'source',
		})
	}
	if (targetTile) {
		character.game.enqueueConveyEvent({
			...base,
			ownerUid: targetTile.uid,
			endpoint: 'target',
		})
	}
}

function enqueueBorderStoragePresentationChange(character: Character, coord: AxialCoord): void {
	if (isTileCoord(coord)) return
	const border = character.game.hex.getBorder(coord)
	if (border) character.game.enqueueStoragePresentationChange(border)
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

const transformBoundaryDurationSeconds = 0.5

class TransformProcessStep extends AEvolutionStep {
	override get description(): string | false {
		return `transform.${this.alveolus.name}`
	}

	override get descriptionKey(): TextKey {
		return { key: 'transform.process', params: { alveolus: this.alveolus.name } }
	}

	get type() {
		return 'work' as const
	}

	constructor(
		private readonly alveolus: TransformAlveolus,
		duration: number,
		private readonly startBuffers: Partial<Record<GoodType, number>>
	) {
		super(duration, `transform.${alveolus.name}`)
	}

	override evolve(evolution: number): void {
		for (const [goodType, rate] of this.alveolus.rateEntries) {
			const start = this.startBuffers[goodType] ?? 0
			this.alveolus.setProcessBuffer(goodType, start + rate * this.duration * evolution)
		}
	}
}

function transformProcessDuration(alveolus: TransformAlveolus): number | undefined {
	let duration = Number.POSITIVE_INFINITY
	for (const [goodType, rate] of alveolus.rateEntries) {
		const buffer = alveolus.processBuffer(goodType)
		if (rate < 0 && buffer > epsilon) {
			duration = Math.min(duration, buffer / -rate)
		} else if (rate > 0 && buffer < 1 - epsilon) {
			duration = Math.min(duration, (1 - buffer) / rate)
		}
	}
	return Number.isFinite(duration) && duration > epsilon ? duration : undefined
}

class WorkFunctions {
	declare [subject]: Character
	@contract('WorkPlan')
	prepare(workPlan: WorkPlan) {
		const character = this[subject]
		const targetCoord = toAxialCoord(workPlan.target?.tile?.position)
		traces.work.log?.('work.prepare.begin', {
			character: character.name,
			characterUid: character.uid,
			job: workPlan.job,
			target: workPlan.target?.name,
			targetQ: targetCoord?.q,
			targetR: targetCoord?.r,
			assignedAlveolus: character.assignedAlveolus?.name,
			preparationTime: character.assignedAlveolus?.preparationTime,
		})
		if (['convey', 'vehicleOffload', 'transform'].includes(workPlan.job)) {
			traces.work.log?.('work.prepare.skip', {
				character: character.name,
				characterUid: character.uid,
				job: workPlan.job,
				reason: 'instant-job',
			})
			return
		}
		assert(
			character.assignedAlveolus?.preparationTime,
			'assignedAlveolus must be set and have a preparationTime'
		)
		return new DurationStep(
			character.assignedAlveolus!.preparationTime,
			'work',
			`prepare.${workPlan.job}`,
			{ key: 'work.prepare', params: { job: workPlan.job } }
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
		if (workPlan?.job === 'transform' && alveolus instanceof TransformAlveolus) {
			return alveolus.nextJob(this[subject])
		}
		assert(
			'getJob' in alveolus && typeof alveolus.getJob === 'function',
			'alveolus must have getJob method'
		)
		const job = alveolus.getJob(this[subject])
		const targetCoord = toAxialCoord(alveolus.tile?.position)
		const path = job && 'path' in job ? job.path : undefined
		if (workPlan && Array.isArray(path)) {
			;(workPlan as WorkPlan & { currentJobPath?: typeof path }).currentJobPath = path
		}
		traces.work.log?.('work.myNextJob', {
			character: this[subject].name,
			characterUid: this[subject].uid,
			requestedJob: workPlan?.job,
			alveolus: alveolus.name,
			alveolusQ: targetCoord?.q,
			alveolusR: targetCoord?.r,
			job: job?.job,
			hasPath: Array.isArray(path),
			pathLen: Array.isArray(path) ? path.length : undefined,
			pathEndQ: Array.isArray(path) ? path.at(-1)?.q : undefined,
			pathEndR: Array.isArray(path) ? path.at(-1)?.r : undefined,
			workPlanningRevision: this[subject].game.workPlanningRevision,
		})
		return job
	}

	@contract('WorkPlan')
	walkToCurrentJobTarget(workPlan: WorkPlan) {
		const character = this[subject]
		let path = (workPlan as WorkPlan & { currentJobPath?: AxialCoord[] }).currentJobPath
		if (!Array.isArray(path)) {
			const job = character.assignedAlveolus?.getJob(character)
			path =
				job?.job === workPlan.job && 'path' in job && Array.isArray(job.path)
					? job.path.map((step) => toAxialCoord(step)).filter((step): step is AxialCoord => !!step)
					: undefined
		}
		const terminal = Array.isArray(path) ? path.at(-1) : undefined
		if (!terminal) return
		const targetTile = character.game.hex.getTile(terminal)
		if (!targetTile) return
		const from = toAxialCoord(character.position)
		const to = toAxialCoord(targetTile.position)
		if (!from || !to) return
		if (axial.key(axial.round(from)) === axial.key(axial.round(to))) return
		const duration =
			character.tile.effectiveWalkTime *
			character.mobilityMultiplier *
			Math.max(1, axial.distance(axial.round(from), axial.round(to)))
		if (!Number.isFinite(duration) || duration <= epsilon) return
		return new MoveToStep(
			duration,
			character,
			targetTile.position,
			'walk',
			`walk.${workPlan.job}`
		).onFulfilled(() => {
			;(character as unknown as { _tile: typeof targetTile })._tile = targetTile
			character.game.invalidateWorkPlanning('character.position')
		})
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

	@contract('object')
	inConveyRange(jobPlan: WorkPlan) {
		const character = this[subject]
		const target = jobPlan.target
		if (!target || !('tile' in target)) return false
		const characterCoord = toAxialCoord(character.tile.position)
		const targetCoord = toAxialCoord(target.tile.position)
		if (!characterCoord || !targetCoord) return false
		return axial.key(characterCoord) === axial.key(targetCoord)
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
			movement.provider.hive.invalidateConveyPlanning('movement.claim')
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
			movement.provider.hive.invalidateConveyPlanning('movement.unclaim')
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
		if (!onAssignedTile) {
			traces.convey.warn?.('[conveyStep] skipped: character is off assigned alveolus tile', {
				character: character.uid,
				characterTile: characterCoord ? axial.key(characterCoord) : undefined,
				assignedTile: assignedCoord ? axial.key(assignedCoord) : undefined,
				alveolus: alveolus.name,
				actionDescription: character.actionDescription,
			})
			return undefined
		}
		// Get movement(s) - either a single movement or a cycle
		const movements = alveolus.aGoodMovement
		if (!movements || movements.length === 0) {
			traces.convey.log?.(`[conveyStep] no movement for ${alveolus.name}`, {
				character: character.uid,
				alveolus: alveolus.name,
				incomingGoods: alveolus.incomingGoods,
			})
			alveolus.hive?.invalidateConveyPlanning('conveyStep.no-work')
			return waitStep()
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
			const sourceFulfilled = false
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
				enqueueBorderStoragePresentationChange(character, from)
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

				const hop = movement.prepareHop()
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
		const descriptionKey =
			movementData.length === 1
				? {
						key: 'work.convey',
						params: { goodType: movementData[0].movement.goodType },
					}
				: { key: 'work.convey.cycle' }
		const visualMovements = getConveyVisualMovements(movementData)
		const conveyStepRef: { step?: MultiMoveStep } = {}
		const step = new MultiMoveStep(
			totalTime,
			visualMovements,
			'work',
			description,
			() => {
				if (!rebindConveyMovementRows(movementData)) {
					conveyStepRef.step?.cancel('stale-rebind')
				}
			},
			true,
			true,
			descriptionKey
		).addTraceInfo({
			characterUid: character.uid,
			characterName: character.name,
			alveolus: alveolus.name,
			movements: movementData.map(({ movement, from, hop }) => ({
				goodType: movement.goodType,
				movementRef: movementRefId(movement.ref),
				from: axial.key(from),
				hop: axial.key(hop),
				pathLength: movement.path.length,
				provider: movement.provider.name,
				demander: movement.demander.name,
			})),
		}) as MultiMoveStep
		conveyStepRef.step = step
		for (const { movement, hop } of movementData) {
			if (!movement.path.length) continue
			// The final tile hop is already covered by the movement target allocation. Allocating
			// the tile storage again here can reject valid dock deliveries before the vehicle receives them.
			if (movement.path.length === 1 && isTileCoord(hop)) continue
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
				step.cancel('conveyStep.hop-allocation-failed')
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
				}
			})
			.onFulfilled(() => {
				const hopAllocationFulfilled = new Set<TrackedMovement['ref']>()
				try {
					for (const { movement } of movementData) {
						if (
							movement.path.length &&
							!(movement.path.length === 1 && isTileCoord(movement.path[0]!))
						) {
							hopAllocationFulfilled.add(movement.ref)
						}
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
						movementHive.fulfillMovementSource(movement, 'conveyStep.finished.source')
						if (!isTileCoord(row.from)) {
							const sourceStorage = movementHive.storageAt(row.from)
							if (sourceStorage?.available(movement.goodType)) {
								sourceStorage.removeGood(movement.goodType, 1)
							}
						}
						row.sourceFulfilled = true
						const landed = movement.hop()!
						assert(
							axial.key(landed) === axial.key(hop),
							`conveyStep.fulfilled: hop drifted ${axial.key(landed)} !== ${axial.key(hop)}`
						)
						if (!movement.path.length) {
							if (!movement.allocations?.target) {
								console.error('Target allocation missing for', movement)
								throw new ConveyStaleBookkeepingError('Target allocation missing')
							}
							const demanderStorage = movement.demander.storage
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
							enqueueConveyedHopEvents(character, movement, row.from, hop)
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
							// Only re-index the movement when another conveyor still needs to pick it up.
							// Final-hop movements should stay out of hive.movingGoods; otherwise terminal
							// path=[] ghost entries can linger at the destination and poison job selection.
							movement.place()
							movementHive.noteMovementStorageCheckpoint(
								movement,
								'conveyStep.after-place.storage',
								hop
							)
							movementHive.assertMovementMine(movement, {
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
								!movementHive.ensureMovementInvariant(movement, {
									expectedFrom: hop,
									warnLabel: '[conveyStep] Invalid movement after place',
								})
							) {
								throw new ConveyStaleBookkeepingError('Movement became invalid after place')
							}
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
							enqueueConveyedHopEvents(character, movement, row.from, hop)
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
		if (action.deposit !== unbuiltLand.deposit?.name) {
			const tileCoord = toAxialCoord(this[subject].tile.position)
			traces.work.warn?.('work.harvestStep.skip', {
				character: this[subject].name,
				characterUid: this[subject].uid,
				reason: 'deposit-mismatch',
				assignedAlveolus: this[subject].assignedAlveolus?.name,
				expectedDeposit: action.deposit,
				actualDeposit: unbuiltLand.deposit?.name,
				tileQ: tileCoord?.q,
				tileR: tileCoord?.r,
			})
			this[subject].game.invalidateWorkPlanning('harvest.deposit-mismatch')
			return
		}
		const isMaturePlantedTree =
			action.deposit === 'tree' &&
			unbuiltLand.deposit?.name === 'tree' &&
			hasMaturePlantedTree(unbuiltLand)
		const outputMultiplier = isMaturePlantedTree ? plantedTreeWoodYield : 1
		if (!isMaturePlantedTree || !harvestMaturePlantedTree(unbuiltLand)) {
			const deposit = unbuiltLand.deposit!
			deposit.amount -= 1
			if (deposit.amount <= 0) {
				unbuiltLand.deposit = undefined
				unbuiltLand.plantedTrees = undefined
			} else if (unbuiltLand.plantedTrees) {
				unbuiltLand.plantedTrees = normalizePlantedTrees(unbuiltLand.plantedTrees, deposit)
			}
			this[subject].game.notifyTerrainDepositsChanged(this[subject].tile)
		}
		return new DurationStep(
			this[subject].assignedAlveolus!.workTime,
			'work',
			`harvest.${this[subject].assignedAlveolus!.name}`,
			{ key: 'work.harvest', params: { alveolus: this[subject].assignedAlveolus!.name } }
		).onFulfilled(() => {
			const character = this[subject]
			const { game, tile } = character
			for (const [goodType, qty] of Object.entries(alveolus.action.output) as [
				GoodType,
				number,
			][]) {
				let remaining = qty * outputMultiplier
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
	plantTreeStep() {
		const forester = this[subject].assignedAlveolus
		assert(forester instanceof ForesterAlveolus, 'assignedAlveolus must be a forester')
		return new DurationStep(forester.workTime, 'work', 'forester.plant-in-zone', {
			key: 'work.forester',
			params: { alveolus: forester.name },
		}).onFulfilled(() => {
			forester.plantAtCurrentTile(this[subject])
		})
	}
	@contract()
	transformStep() {
		const alveolus = this[subject].assignedAlveolus as TransformAlveolus
		assert(alveolus, 'assignedAlveolus must be set')
		assert(alveolus.action.type === 'transform', 'assignedAlveolus.action must be a transform')
		if (!alveolus.canWork) return

		const unloadGood = alveolus.nextUnloadGood
		if (unloadGood) {
			const commitment = new Commitment(`transform.unload.${alveolus.name}.${unloadGood}`)
			const result = alveolus.storage.allocate({ [unloadGood]: 1 }, commitment)
			if (result !== undefined) {
				console.error('[transformStep] Failed to allocate unload output:', result)
				commitment.cancel('transform.unload.failed')
				return waitStep()
			}
			return new DurationStep(
				transformBoundaryDurationSeconds,
				'work',
				`transform.unload.${alveolus.name}.${unloadGood}`,
				{ key: 'transform.unload', params: { alveolus: alveolus.name, goodType: unloadGood } }
			)
				.onFulfilled(() => {
					commitment.fulfill()
					alveolus.setProcessBuffer(unloadGood, 0)
				})
				.onCancelled(() => {
					commitment.cancel('transform.unload.cancelled')
				})
		}

		const loadGood = alveolus.nextLoadGood
		if (loadGood) {
			const commitment = new Commitment(`transform.load.${alveolus.name}.${loadGood}`)
			const result = alveolus.storage.reserve({ [loadGood]: 1 }, commitment)
			if (result !== undefined) {
				console.error('[transformStep] Failed to reserve load input:', result)
				commitment.cancel('transform.load.failed')
				return waitStep()
			}
			return new DurationStep(
				transformBoundaryDurationSeconds,
				'work',
				`transform.load.${alveolus.name}.${loadGood}`,
				{ key: 'transform.load', params: { alveolus: alveolus.name, goodType: loadGood } }
			)
				.onFulfilled(() => {
					commitment.fulfill()
					alveolus.setProcessBuffer(loadGood, 1)
				})
				.onCancelled(() => {
					commitment.cancel('transform.load.cancelled')
				})
		}

		const duration = transformProcessDuration(alveolus)
		if (duration === undefined) {
			return waitStep()
		}
		return new TransformProcessStep(alveolus, duration, { ...alveolus.processBuffers })
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
		const character = this[subject]
		const tileCoord = toAxialCoord(character.tile.position)
		const content = character.tile.content
		if (!(content instanceof UnBuiltLand) || !content.project) {
			traces.work.warn?.('work.foundationStep.skip', {
				character: character.name,
				characterUid: character.uid,
				reason: 'not-project-land',
				tileQ: tileCoord?.q,
				tileR: tileCoord?.r,
				contentType: content?.constructor?.name,
			})
			return
		}
		if (content.tile.isBurdened) {
			traces.work.warn?.('work.foundationStep.skip', {
				character: character.name,
				characterUid: character.uid,
				reason: 'tile-burdened',
				tileQ: tileCoord?.q,
				tileR: tileCoord?.r,
				looseGoods: content.tile.looseGoods.length,
				availableLooseGoods: content.tile.availableGoods.length,
			})
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
		setConstructionFoundationDeliveredGoods(
			constructionSite,
			content.foundationStorage?.stock ?? {}
		)
		if (!foundationGoodsComplete(constructionSite)) {
			traces.work.warn?.('work.foundationStep.skip', {
				character: character.name,
				characterUid: character.uid,
				reason: 'missing-foundation-goods',
				tileQ: tileCoord?.q,
				tileR: tileCoord?.r,
				requiredGoods: constructionSite.foundationRequiredGoods,
				deliveredGoods: constructionSite.foundationDeliveredGoods,
			})
			return
		}
		constructionSite.phase = 'foundation'
		traces.work.log?.('work.foundationStep.start', {
			character: character.name,
			characterUid: character.uid,
			project,
			tileQ: tileCoord?.q,
			tileR: tileCoord?.r,
			targetKind: target.kind,
			target: target.kind === 'alveolus' ? target.alveolusType : target.tier,
		})
		return new DurationStep(
			constructionSite.foundationWorkSeconds,
			'work',
			'foundation'
		).onFulfilled(() => {
			for (const [good, qty] of Object.entries(constructionSite.foundationRequiredGoods)) {
				content.foundationStorage?.removeGood(good as GoodType, qty ?? 0)
			}
			setConstructionFoundationConsumedGoods(
				constructionSite,
				constructionSite.foundationRequiredGoods
			)
			applyConstructionConcreteTerrain(content.tile)
			content.tile.content = createConstructionShell(content.tile, constructionSite)
			if (target.kind === 'dwelling') {
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
		if (isConstructionSiteShell(content)) {
			const site = content
			assert(site.isReady, 'Construction site must be ready')
			const totalSeconds = site.constructionSite.recipe.workSeconds
			const remaining = Math.max(0, totalSeconds - site.constructionWorkSecondsApplied)
			const stepDescription = constructionShellStepDescription(site)
			const finalize = () => finalizeConstructionShell(site)
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
		assert(false, 'Tile must be a construction site shell')
	}
}

export { WorkFunctions }
