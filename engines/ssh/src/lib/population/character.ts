import { vehicles as vehicleRules } from 'engine-rules'
import { inert, reactive, unwrap } from 'mutts'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import { assert, traceIdleDiagnosis, traces } from 'ssh/debug'
import { assertVehicleOperationConsistency } from 'ssh/freight/vehicle-invariants'
import { releaseVehicleFreightWorkOnPlanInterrupt } from 'ssh/freight/vehicle-run'
import type { Game } from 'ssh/game'
import {
	activityUtilityConfig,
	applyActivityHysteresis,
	computeActivityScores,
	excludeWanderAfterWanderWhenEmployable,
	type NextActivityKind,
	type PlannerFindActionSnapshot,
} from 'ssh/population/findNextActivity'
import type { Storage } from 'ssh/storage'
import { traceProjection } from 'ssh/trace'
import type { Job, WorkPlan } from 'ssh/types/base'
import { type AxialCoord, axial, type Positioned } from 'ssh/utils'
import { type Position, toAxialCoord } from 'ssh/utils/position'
import {
	applyNeedRate,
	characterEvolutionRates,
	characterTriggerLevels,
	dwellingRecoveryRates,
	maxWalkTime,
	readCharacterEvolutionRate,
	residentialRecoveryRates,
} from '../../../assets/constants'

// Simple job scoring functions
function calculateJobScore(_character: Character, job: Job): number {
	return job.urgency
}
function bestPossibleJobScore(_character: Character): number {
	return Number.POSITIVE_INFINITY
}

function relativeJobScore(score: number, pathLength: number): number {
	return score / (pathLength + 1)
}

function vehicleFreightPathLength(job: Job): number {
	switch (job.job) {
		case 'vehicleHop':
			return job.path.length + (job.approachPath?.length ?? 0)
		case 'zoneBrowse':
		case 'vehicleOffload':
			return job.path.length
		default:
			return 0
	}
}

function vehicleFreightJobTracePayload(job: Job): Record<string, unknown> {
	switch (job.job) {
		case 'vehicleHop':
			return {
				job: job.job,
				vehicleUid: job.vehicleUid,
				lineId: job.lineId,
				stopId: job.stopId,
				dockEnter: job.dockEnter,
				needsBeginService: job.needsBeginService,
				approachLen: job.approachPath?.length ?? 0,
				zoneBrowseAction: job.zoneBrowseAction,
				goodType: job.goodType,
				quantity: job.quantity,
				targetCoord: job.targetCoord,
				pathLen: job.path.length,
			}
		case 'zoneBrowse':
			return {
				job: job.job,
				vehicleUid: job.vehicleUid,
				lineId: job.lineId,
				stopId: job.stopId,
				zoneBrowseAction: job.zoneBrowseAction,
				goodType: job.goodType,
				quantity: job.quantity,
				targetCoord: job.targetCoord,
				pathLen: job.path.length,
			}
		case 'vehicleOffload':
			return {
				job: job.job,
				vehicleUid: job.vehicleUid,
				maintenanceKind: job.maintenanceKind,
				goodType: job.maintenanceKind === 'loadFromBurden' ? job.looseGood.goodType : undefined,
				targetCoord: job.targetCoord,
				pathLen: job.path.length,
			}
		default:
			return { job: job.job }
	}
}

function roundDiagnosticValue(value: number): number {
	return Math.round(value * 1000) / 1000
}

import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { collectVehicleWorkPicks, isVehicleFreightJob } from 'ssh/freight/vehicle-work'
import { GameObject, withInteractive, withTicked } from 'ssh/game/object'
import { gameIsaTypes } from 'ssh/npcs'
import aCharacterContext from 'ssh/npcs/context'
import { withScripted } from 'ssh/npcs/object'
import type { ScriptExecution } from 'ssh/npcs/scripts'
import type { ASingleStep } from 'ssh/npcs/steps'
import { releaseAllHomeReservations } from 'ssh/residential/housing-reservations'
import type { VehicleEntity } from './vehicle/entity'

export interface RankedWorkCandidateSnapshot {
	jobKind: Job['job']
	targetLabel: string
	targetCoord: { q: number; r: number }
	urgency: number
	pathLength: number
	score: number
	selected: boolean
}

export interface RankedWorkPlannerSnapshot {
	ranked: ReadonlyArray<RankedWorkCandidateSnapshot>
}

interface RankedWorkCandidate {
	job: Job
	targetTile: Tile
	path: AxialCoord[]
	pathLength: number
	score: number
}

@reactive
export class Character extends withInteractive(withScripted(withTicked(GameObject))) {
	readonly triggerLevels = characterTriggerLevels

	// Character needs levels (starting at 0, incrementing 1 per second)
	public hunger: number = 0
	public tiredness: number = 0
	public fatigue: number = 0

	/** Stabilizes `findNextActivity` picks across replans. */
	lastPickedActivityKind: NextActivityKind | undefined

	/**
	 * Last `findAction` resolution: post-hysteresis ranked utilities and whether the script came
	 * from that list (`ranked`) or from the emergency `wander()` when every ranked kind failed
	 * `tryScript` (`fallback-wander`). See `traceIdleDiagnosis` / `blackBoxLog.idleDiagnosis`.
	 */
	lastPlannerSnapshot?: PlannerFindActionSnapshot
	lastWorkPlannerSnapshot?: RankedWorkPlannerSnapshot

	get workPlannerSnapshot(): RankedWorkPlannerSnapshot | undefined {
		return this.buildRankedWorkSnapshot(this.resolveBestJobMatch()) ?? this.lastWorkPlannerSnapshot
	}
	// TODO: assigned should become `assignedAlveolus | operates`.
	private _assignedAlveolus: Alveolus | undefined
	public get assignedAlveolus(): Alveolus | undefined {
		return this._assignedAlveolus
	}
	public set assignedAlveolus(value: Alveolus | undefined) {
		const normalize = (v: any) => (v === null ? undefined : unwrap(v))
		value = normalize(value)
		const current = normalize(this._assignedAlveolus)

		if (value === current) return

		assert(!value !== !current, 'assigned alveolus mismatch')
		this._assignedAlveolus = value
	}
	private _operatedVehicle?: VehicleEntity
	public get operates(): VehicleEntity | undefined {
		return this._operatedVehicle
	}
	public set operates(value: VehicleEntity | undefined) {
		const current = this._operatedVehicle
		if (current?.uid === value?.uid) return
		if (value) {
			assert(
				value.service,
				`Vehicle ${value.uid} must have an active service before operates assignment`
			)
			value.setServiceOperator(this)
			return
		}
		if (current) {
			current.releaseOperator(this)
			// A stale operates link can outlive service in interrupted/error paths; clear the
			// character side even when the vehicle has no service left to release.
			if (this._operatedVehicle?.uid === current.uid) this.setOperatedVehicleFromService(undefined)
		}
	}

	setOperatedVehicleFromService(vehicle: VehicleEntity | undefined): void {
		const current = this._operatedVehicle
		if (current?.uid === vehicle?.uid) return
		this._operatedVehicle = vehicle
	}
	private _footPosition?: Position
	private _scriptsContext?: any
	public get scriptsContext() {
		return (this._scriptsContext ??= aCharacterContext(this))
	}
	private _tile!: Tile

	get tile(): Tile {
		return this._tile
	}

	get driving(): boolean {
		return !!this.operates && !this._footPosition
	}

	get position(): Position {
		return this._footPosition ?? this.operates?.position ?? this._tile.position
	}

	set position(value: Position) {
		if (this._footPosition) {
			this._footPosition = reactive(value)
			return
		}
		assert(this.operates, 'position set requires an operated vehicle')
		this.operates.position = reactive(value)
	}

	constructor(
		game: Game,
		uid: string,
		public name: string,
		position: Position
	) {
		super(game, uid)
		this._footPosition = reactive(position)
		const ax = toAxialCoord(this.position)
		this._tile = game.hex.getTile({
			q: Math.round(ax.q),
			r: Math.round(ax.r),
		})!
		// Allocate initial occupancy on the board
		const queueStep = this.game.hex.moveCharacter(this, this._tile.position)
		assert(!queueStep, 'Character must not be queuing on creation')
		if (queueStep) this.stepExecutor = queueStep
	}

	/** Requires `operates` to already reference the vehicle being boarded (same tile). */
	onboard(): void {
		const vehicle = this.operates
		assert(vehicle, 'Character must have operates before boarding')
		const characterHex = axial.round(toAxialCoord(this.position)!)
		const vehicleHex = axial.round(toAxialCoord(vehicle.position)!)
		assert(
			axial.key(characterHex) === axial.key(vehicleHex),
			`Character must be at vehicle position before boarding`
		)
		// While onboard, character position is fully delegated to the operated vehicle.
		this._footPosition = undefined
		this._tile = this.game.hex.getTile(axial.round(toAxialCoord(vehicle.position)))!
	}

	private regainFootPosition(position: Position): void {
		const coord = axial.round(toAxialCoord(position)!)
		const tile = this.game.hex.getTile(coord)!
		const previousTile = this._tile
		this._footPosition = reactive({ ...position })
		if (axial.key(toAxialCoord(previousTile.position)!) === axial.key(coord)) {
			this._tile = tile
			return
		}
		const queueStep = this.game.hex.moveCharacter(this, tile.position, previousTile.position)
		if (queueStep) {
			if (!this.stepExecutor) {
				this.stepExecutor = queueStep.finished(() => {
					this._tile = tile
				})
			}
			return
		}
		this._tile = tile
	}

	offboard(): void {
		const v = this.operates
		assert(v, 'offboard requires an operated vehicle')
		if (v.service) {
			traces.vehicle.log?.('vehicleJob.offboard.endService', { vehicleUid: v.uid })
			v.endService()
		}
		traces.vehicle.log?.('vehicleJob.offboard', {
			character: this.name,
			characterUid: this.uid,
			vehicleUid: v.uid,
		})
		this.regainFootPosition(v.position)
		this.operates = undefined
		assertVehicleOperationConsistency(v, this)
	}

	/**
	 * Step off the operated vehicle while still keeping the operator <-> vehicle link.
	 * Used by zone browse flows: the character regains a foot position for the local transfer but
	 * the vehicle remains the active transport seam until the script explicitly disengages.
	 */
	stepOffVehicleKeepingControl(): void {
		const v = this.operates
		assert(v, 'stepOffVehicleKeepingControl requires an operated vehicle')
		this.regainFootPosition(v.position)
		traces.vehicle.log?.('vehicleJob.offboard.keepControl', {
			characterUid: this.uid,
			vehicleUid: v.uid,
		})
		assertVehicleOperationConsistency(v, this)
	}

	/** Re-board the currently linked vehicle after {@link stepOffVehicleKeepingControl}. */
	boardLinkedVehicle(): void {
		assert(this.operates, 'boardLinkedVehicle requires an operated vehicle')
		this.onboard()
	}

	/**
	 * Release the operator <-> vehicle link while the vehicle keeps {@link VehicleEntity.service}.
	 * Used by both docked bay and zone browse flows.
	 */
	disengageVehicleKeepingService(): void {
		const v = this.operates
		assert(v, 'disengageVehicleKeepingService requires an operated vehicle')
		v.releaseOperator(this)
		traces.vehicle.log?.('vehicleJob.offboard.keepService', {
			characterUid: this.uid,
			vehicleUid: v.uid,
		})
		this.regainFootPosition(this._footPosition ?? v.position)
		this.operates = undefined
		assertVehicleOperationConsistency(v, this)
	}

	/** @deprecated Prefer {@link disengageVehicleKeepingService}. */
	disembarkVehicleKeepingService(): void {
		this.disengageVehicleKeepingService()
	}

	/** Attempt to step onto a tile, managing board occupancy. */
	stepOn(tile: Tile) {
		// Discrete hex adjacency: fractional lerp positions (e.g. `walk.until` midpoints) must not
		// spuriously fail the old float `axialDistance > 1.1` guard on otherwise valid neighbor steps.
		const curAx = toAxialCoord(this.position)
		const destAx = toAxialCoord(tile.position)
		if (!curAx || !destAx) return false
		const here = axial.round(curAx)
		const there = axial.round(destAx)
		if (axial.distance(here, there) > 1) return false
		const fromPos = this.driving && this.operates ? this.position : this._tile.position
		const queue = this.game.hex.moveCharacter(this, tile.position, fromPos)
		if (queue)
			return queue.finished(() => {
				this._tile = tile
			})
		this._tile = tile
	}

	get title(): string {
		return this.name
	}

	get [traceProjection]() {
		const role = (this as { role?: unknown }).role
		return {
			$type: 'Character',
			uid: this.uid,
			name: this.name,
			role: typeof role === 'string' ? role : undefined,
			position: this.position,
			driving: this.driving,
			vehicleUid: this.operates?.uid,
		}
	}

	private workExecution(job: Job, targetTile: Tile, path: AxialCoord[]): ScriptExecution {
		const safePath = path.filter((step): step is AxialCoord => !!step)
		// TODO: organise a bit so we don't have hard-coded type list, or at minimum make an array.includes - but at best, find a logical way to test (existence of job.vehicleUid?) instead
		if (isVehicleFreightJob(job)) {
			const vehicle = this.game.vehicles.vehicle(job.vehicleUid)
			if (!vehicle) return this.scriptsContext.selfCare.wander()
			if (this._operatedVehicle && this._operatedVehicle.uid !== vehicle.uid) {
				return this.scriptsContext.selfCare.wander()
			}
			const workPlan: WorkPlan = {
				...job,
				type: 'work',
				target: vehicle,
				path: safePath,
			}
			return this.scriptsContext.work.goWork(workPlan)
		}
		const jobProvider = targetTile.content!
		const target = jobProvider
		const workPlan: WorkPlan = {
			...job,
			type: 'work',
			target,
			path: safePath,
		}
		return this.scriptsContext.work.goWork(workPlan)
	}

	private sameTilePath(targetTile: Tile): AxialCoord[] | false {
		const isSameTile =
			axial.key(toAxialCoord(targetTile.position)!) === axial.key(toAxialCoord(this.position)!)
		if (isSameTile) return []
		return (
			this.game.hex.findPathForCharacter(
				this.position,
				targetTile.position,
				this,
				maxWalkTime,
				false
			) ?? false
		)
	}

	private describeWorkTarget(job: Job, targetTile: Tile): string {
		const coord = toAxialCoord(targetTile.position)!
		const tileLabel = `Tile ${coord.q}, ${coord.r}`
		const targetName = targetTile.content?.name
			? `${targetTile.content.name} @ ${coord.q}, ${coord.r}`
			: tileLabel

		switch (job.job) {
			case 'vehicleOffload': {
				const t = job.targetCoord
				const detail =
					job.maintenanceKind === 'loadFromBurden' ? job.looseGood.goodType : job.maintenanceKind
				return `vehicleOffload ${detail} @ ${t.q},${t.r} (${job.vehicleUid})`
			}
			case 'defragment':
				return `${job.goodType} @ ${targetName}`
			case 'vehicleHop':
				return `vehicleHop ${job.lineId}/${job.stopId} @ ${coord.q}, ${coord.r}`
			case 'zoneBrowse':
				return `zoneBrowse ${job.zoneBrowseAction}:${job.goodType} @ ${job.targetCoord.q}, ${job.targetCoord.r}`
			default:
				return targetName
		}
	}

	private rankedWorkCandidates(): RankedWorkCandidate[] {
		return inert(() => {
			const candidates: RankedWorkCandidate[] = []
			for (const pick of collectVehicleWorkPicks(this.game, this)) {
				const path = pick.job.path
				const pathLength = vehicleFreightPathLength(pick.job)
				candidates.push({
					job: pick.job,
					targetTile: pick.targetTile,
					path,
					pathLength,
					score: relativeJobScore(calculateJobScore(this, pick.job), pathLength),
				})
			}
			for (const tile of this.game.hex.tiles) {
				const job = tile.getJob?.(this)
				if (!job) continue

				const path = this.sameTilePath(tile)
				if (path === false) continue

				const pathLength = path.length
				candidates.push({
					job,
					targetTile: tile,
					path,
					pathLength,
					score: relativeJobScore(calculateJobScore(this, job), pathLength),
				})
			}

			return candidates.sort((a, b) => {
				if (b.score !== a.score) return b.score - a.score
				if (b.job.urgency !== a.job.urgency) return b.job.urgency - a.job.urgency
				if (a.pathLength !== b.pathLength) return a.pathLength - b.pathLength
				return axial
					.key(toAxialCoord(a.targetTile.position)!)
					.localeCompare(axial.key(toAxialCoord(b.targetTile.position)!))
			})
		})
	}

	private sameWorkMatch(
		candidate: Pick<RankedWorkCandidate, 'job' | 'targetTile'>,
		match: { job: Job; targetTile: Tile } | false
	): boolean {
		if (!match) return false
		const candidateCoord = axial.key(toAxialCoord(candidate.targetTile.position)!)
		const matchCoord = axial.key(toAxialCoord(match.targetTile.position)!)
		if (candidateCoord !== matchCoord || candidate.job.job !== match.job.job) return false
		if (candidate.job.job === 'vehicleOffload' && match.job.job === 'vehicleOffload') {
			if (
				candidate.job.vehicleUid !== match.job.vehicleUid ||
				axial.key(candidate.job.targetCoord) !== axial.key(match.job.targetCoord) ||
				candidate.job.maintenanceKind !== match.job.maintenanceKind
			) {
				return false
			}
			if (
				candidate.job.maintenanceKind === 'loadFromBurden' &&
				match.job.maintenanceKind === 'loadFromBurden'
			) {
				return candidate.job.looseGood.goodType === match.job.looseGood.goodType
			}
			return true
		}
		if (candidate.job.job === 'zoneBrowse' && match.job.job === 'zoneBrowse') {
			return (
				candidate.job.vehicleUid === match.job.vehicleUid &&
				candidate.job.zoneBrowseAction === match.job.zoneBrowseAction &&
				candidate.job.goodType === match.job.goodType &&
				axial.key(candidate.job.targetCoord) === axial.key(match.job.targetCoord)
			)
		}
		if (candidate.job.job === 'vehicleHop' && match.job.job === 'vehicleHop') {
			const sameTarget =
				(!candidate.job.targetCoord && !match.job.targetCoord) ||
				(!!candidate.job.targetCoord &&
					!!match.job.targetCoord &&
					axial.key(candidate.job.targetCoord) === axial.key(match.job.targetCoord))
			return (
				candidate.job.vehicleUid === match.job.vehicleUid &&
				candidate.job.lineId === match.job.lineId &&
				candidate.job.stopId === match.job.stopId &&
				candidate.job.dockEnter === match.job.dockEnter &&
				candidate.job.needsBeginService === match.job.needsBeginService &&
				(candidate.job.approachPath?.length ?? 0) === (match.job.approachPath?.length ?? 0) &&
				candidate.job.zoneBrowseAction === match.job.zoneBrowseAction &&
				candidate.job.goodType === match.job.goodType &&
				sameTarget
			)
		}
		if (candidate.job.job === 'defragment' && match.job.job === 'defragment') {
			return candidate.job.goodType === match.job.goodType
		}
		return true
	}

	private buildRankedWorkSnapshot(
		match: { job: Job; targetTile: Tile } | false
	): RankedWorkPlannerSnapshot | undefined {
		const ranked = this.rankedWorkCandidates()
		if (ranked.length === 0) return undefined
		return {
			ranked: ranked.map((candidate) => {
				const coord = toAxialCoord(candidate.targetTile.position)!
				return {
					jobKind: candidate.job.job,
					targetLabel: this.describeWorkTarget(candidate.job, candidate.targetTile),
					targetCoord: { q: coord.q, r: coord.r },
					urgency: roundDiagnosticValue(candidate.job.urgency),
					pathLength: candidate.pathLength,
					score: roundDiagnosticValue(candidate.score),
					selected: this.sameWorkMatch(candidate, match),
				}
			}),
		}
	}

	private bestVehicleJobMatch():
		| { job: Job; targetTile: Tile; path: AxialCoord[]; score: number }
		| false {
		let best: { job: Job; targetTile: Tile; path: AxialCoord[]; score: number } | undefined
		for (const pick of collectVehicleWorkPicks(this.game, this)) {
			const path = pick.job.path
			const score = relativeJobScore(
				calculateJobScore(this, pick.job),
				vehicleFreightPathLength(pick.job)
			)
			if (!best || score > best.score) {
				best = { job: pick.job, targetTile: pick.targetTile, path, score }
			}
		}
		return best ?? false
	}

	/**
	 * Resolve best job without starting a script (for planning / utility).
	 */
	resolveBestJobMatch(): { job: Job; targetTile: Tile; path: AxialCoord[] } | false {
		return inert(() => {
			const vehiclePick = this.bestVehicleJobMatch()

			const jobCache = new Map<string, { job: Job; targetTile: Tile }>()

			const scoreJob = (coord: Positioned): number | false => {
				const tile = this.game.hex.getTile(coord)
				if (!tile) return false

				const axCoord = toAxialCoord(coord)!
				const coordKey = axial.key(axCoord)
				const directJob = tile.getJob?.(this)
				if (!directJob) return false

				jobCache.set(coordKey, { job: directJob, targetTile: tile })

				const score = calculateJobScore(this, directJob)
				return score
			}

			const path = this.game.hex.findBestForCharacter(
				this.position,
				this,
				scoreJob,
				maxWalkTime,
				bestPossibleJobScore(this),
				false
			)

			let selectedPath = path
			let match: { job: Job; targetTile: Tile } | undefined
			if (selectedPath && selectedPath.length > 0) {
				const targetCoord = selectedPath[selectedPath.length - 1] as AxialCoord
				const key = `${targetCoord.q},${targetCoord.r}`
				match = jobCache.get(key)
			}
			if (!match) {
				let bestFallback:
					| { path: AxialCoord[]; job: Job; targetTile: Tile; score: number }
					| undefined
				for (const tile of this.game.hex.tiles) {
					if (!(tile.content instanceof Alveolus)) continue
					const job = tile.content.getJob(this)
					if (!job) continue
					const isSameTile =
						axial.key(toAxialCoord(tile.position)!) === axial.key(toAxialCoord(this.position)!)
					const fallbackPath = isSameTile
						? []
						: this.game.hex.findPathForCharacter(
								this.position,
								tile.position,
								this,
								maxWalkTime,
								false
							)
					if (!fallbackPath) continue
					const score = calculateJobScore(this, job) / (fallbackPath.length + 1)
					if (!bestFallback || score > bestFallback.score) {
						bestFallback = { path: fallbackPath, job, targetTile: tile, score }
					}
				}
				if (!bestFallback) {
					if (!vehiclePick) return false
					return {
						job: vehiclePick.job,
						targetTile: vehiclePick.targetTile,
						path: vehiclePick.path,
					}
				}
				selectedPath = bestFallback.path
				match = { job: bestFallback.job, targetTile: bestFallback.targetTile }
			}
			const { job, targetTile } = match
			if (!selectedPath) {
				const isSameTile =
					axial.key(toAxialCoord(targetTile.position)!) === axial.key(toAxialCoord(this.position)!)
				if (!isSameTile) {
					if (!vehiclePick) return false
					return {
						job: vehiclePick.job,
						targetTile: vehiclePick.targetTile,
						path: vehiclePick.path,
					}
				}
				selectedPath = []
			}

			const tileMatch = { job, targetTile, path: selectedPath }
			if (!vehiclePick) return tileMatch
			const vs = vehiclePick.score
			const ts = relativeJobScore(calculateJobScore(this, tileMatch.job), tileMatch.path.length)
			return vs > ts
				? { job: vehiclePick.job, targetTile: vehiclePick.targetTile, path: vehiclePick.path }
				: tileMatch
		})
	}

	/**
	 * Find the best available job using pathfinding
	 * @returns Object with job, tile, and path, or false if no job found
	 */
	findBestJob(): ScriptExecution | false {
		const match = this.resolveBestJobMatch()
		if (!match) return false
		if (isVehicleFreightJob(match.job)) {
			const pos = toAxialCoord(this.position)
			traces.vehicle.log?.('vehicleJob.selected', {
				character: this.name,
				characterUid: this.uid,
				...vehicleFreightJobTracePayload(match.job),
				pathLen: match.path.length,
				characterAxial: pos ? axial.key(pos) : undefined,
			})
		}
		this.log('character.beginJob', match.job.job)
		return this.workExecution(match.job, match.targetTile, match.path)
	}

	get keepWorking(): boolean {
		return (
			this.hunger < this.triggerLevels.hunger.high &&
			this.fatigue < this.triggerLevels.fatigue.high &&
			this.tiredness < this.triggerLevels.tiredness.high
		)
	}

	canInteract(action: string): boolean {
		// Characters can't be built on
		if (action.startsWith('build:')) {
			return false
		}
		// For other actions, characters might be able to act
		// This could be expanded based on character state, assigned alveolus, etc.
		return false
	}

	get debugInfo(): Record<string, any> {
		return {
			name: this.name,
			coord: this.position,
			needs: {
				hunger: this.hunger,
				fatigue: this.fatigue,
				tiredness: this.tiredness,
			},
			keepWorking: this.keepWorking,
			lastPickedActivity: this.lastPickedActivityKind,
			lastPlannerSnapshot: this.lastPlannerSnapshot,
			lastWorkPlannerSnapshot: this.lastWorkPlannerSnapshot,
			vehicle: {
				operatedVehicleUid: this.operates?.uid,
				driving: this.driving,
				activeTransportStorage: this.carry,
			},
		}
	}

	hitTest(coord: AxialCoord, selectedAction?: string): boolean {
		// Simple circular hit test for character
		// If we have a selected action, check if this character can act with it
		if (selectedAction && !this.canInteract(selectedAction)) {
			return false
		}
		return axial.distance(coord, toAxialCoord(this.position)) <= 0.3
	}

	/** Whether this character is currently standing on their reserved home (dwelling or residential tile). */
	get isAtHome(): boolean {
		const pos = toAxialCoord(this.position)
		if (!pos) return false
		const tile = this.game.hex.getTile(pos)
		const content = tile?.content
		if (content instanceof BasicDwelling && content.isReservedBy(this)) {
			return true
		}
		const reservation = this.game.hex.zoneManager.getReservation(this)
		if (!reservation) return false
		return Math.round(pos.q) === reservation.q && Math.round(pos.r) === reservation.r
	}

	update(deltaSeconds: number) {
		const activity: Ssh.ActivityType = (this.stepExecutor?.type ?? 'idle') as Ssh.ActivityType
		const hungerRate = readCharacterEvolutionRate(characterEvolutionRates.hunger, activity)
		const tirednessRate = readCharacterEvolutionRate(characterEvolutionRates.tiredness, activity)
		const fatigueRate = readCharacterEvolutionRate(characterEvolutionRates.fatigue, activity)
		this.hunger = applyNeedRate(this.hunger, hungerRate, deltaSeconds)
		this.tiredness = applyNeedRate(this.tiredness, tirednessRate, deltaSeconds)
		this.fatigue = applyNeedRate(this.fatigue, fatigueRate, deltaSeconds)

		if (this.isAtHome) {
			const pos = toAxialCoord(this.position)
			const tile = pos ? this.game.hex.getTile(pos) : undefined
			const dwelling =
				tile?.content instanceof BasicDwelling && tile.content.isReservedBy(this)
					? tile.content
					: undefined
			const rates = dwelling ? dwellingRecoveryRates : residentialRecoveryRates
			this.hunger = applyNeedRate(this.hunger, -rates.hunger, deltaSeconds)
			this.fatigue = applyNeedRate(this.fatigue, -rates.fatigue, deltaSeconds)
			this.tiredness = applyNeedRate(this.tiredness, -rates.tiredness, deltaSeconds)
		}

		super.update(deltaSeconds)
	}

	findAction() {
		return inert(() => {
			releaseAllHomeReservations(this.game, this)

			const bestWorkMatch = this.resolveBestJobMatch()
			const workSnapshot = this.buildRankedWorkSnapshot(bestWorkMatch)
			if (workSnapshot) this.lastWorkPlannerSnapshot = workSnapshot
			const ranked = excludeWanderAfterWanderWhenEmployable(
				applyActivityHysteresis(
					computeActivityScores(this),
					this.lastPickedActivityKind,
					activityUtilityConfig.hysteresis
				),
				this.lastPickedActivityKind,
				this
			)
			const rankedSnapshot = ranked.map((s) => ({
				kind: s.kind,
				utility: Math.round(s.utility * 1000) / 1000,
			}))

			if (this.keepWorking) {
				const assignedExec = this.tryScriptForActivityKind('assignedWork')
				if (assignedExec) {
					this.lastPickedActivityKind = 'assignedWork'
					this.lastPlannerSnapshot = {
						ranked: rankedSnapshot,
						outcome: { kind: 'assignedWork', source: 'ranked' },
					}
					traceIdleDiagnosis({
						name: this.name,
						...this.lastPlannerSnapshot,
					})
					return assignedExec
				}
				if (bestWorkMatch) {
					const bestWorkExec = this.findBestJob()
					if (bestWorkExec) {
						this.lastPickedActivityKind = 'bestWork'
						this.lastPlannerSnapshot = {
							ranked: rankedSnapshot,
							outcome: { kind: 'bestWork', source: 'ranked' },
						}
						traceIdleDiagnosis({
							name: this.name,
							...this.lastPlannerSnapshot,
						})
						return bestWorkExec
					}
				}
			}

			const offloadDrain = this.tryTransportOffloadDrain()
			if (offloadDrain) return offloadDrain

			for (const pick of ranked) {
				const exec = this.tryScriptForActivityKind(pick.kind)
				if (exec) {
					this.lastPickedActivityKind = pick.kind
					this.lastPlannerSnapshot = {
						ranked: rankedSnapshot,
						outcome: { kind: pick.kind, source: 'ranked' },
					}
					traceIdleDiagnosis({
						name: this.name,
						...this.lastPlannerSnapshot,
					})
					return exec
				}
			}

			this.lastPlannerSnapshot = {
				ranked: rankedSnapshot,
				outcome: { kind: 'wander', source: 'fallback-wander' },
			}
			traceIdleDiagnosis({
				name: this.name,
				...this.lastPlannerSnapshot,
				note: 'all ranked kinds failed tryScript (stale job, no path, guards, …)',
			})
			return this.scriptsContext.selfCare.wander()
		})
	}

	/**
	 * If we're operating a vehicle but still have offloadable loose-good buffer in active transport,
	 * finish draining it before picking wander/eat/etc. Otherwise work scripts can end while stock
	 * remains trapped on the wheelbarrow (vehicleOffload returns after `inventory.offloadDropBuffer`
	 * yields walking steps; the planner may pick wander before drops complete).
	 */
	/** @internal Used by scripted object update to preempt long rests while stock can be offloaded. */
	maybeTransportOffloadDrain(): ScriptExecution | ASingleStep | false {
		return this.tryTransportOffloadDrain()
	}

	private tryTransportOffloadDrain(): ScriptExecution | ASingleStep | false {
		if (!this.driving || !this.operates) return false
		const carry = this.carry
		if (!carry) return false
		// Use stock (not only `dropCandidateGoodTypes`) — reactive `Object.keys(stock)` can be flaky in some
		// edge cases, and we still gate actual dropping on `available()` inside `dropAsLooseGood`.
		const hasStock = Object.values(carry.stock).some((q) => typeof q === 'number' && q > 0)
		if (!hasStock) return false
		const inv = this.scriptsContext.inventory
		// Only drain once we're already on a legal wild offload tile. Otherwise `inventory.offloadDropBuffer`
		// may return `false` without yielding (walk attempts exhausted / no path), which would spin `findAction`
		// forever if we always re-select this script. Walking to a valid offload tile is handled by work scripts
		// like `vehicleOffload` / scripted `walk.into` inside `offloadDropBuffer`.
		if (!inv.canDropLooseHere()) return false
		return inv.offloadDropBuffer()
	}

	private releaseVehicleBeforeNonVehicleActivity(kind: NextActivityKind): void {
		if (!this.operates) return
		traces.vehicle.warn?.('vehicle operator released before non-vehicle activity', {
			characterUid: this.uid,
			vehicleUid: this.operates.uid,
			activityKind: kind,
		})
		releaseVehicleFreightWorkOnPlanInterrupt(this)
	}

	private tryScriptForActivityKind(kind: NextActivityKind): ScriptExecution | false | undefined {
		switch (kind) {
			case 'eat':
				if (!(this.hunger > this.triggerLevels.hunger.satisfied)) return false
				this.releaseVehicleBeforeNonVehicleActivity(kind)
				return this.scriptsContext.selfCare.goEat()
			case 'home':
				if (this.keepWorking) return false
				this.releaseVehicleBeforeNonVehicleActivity(kind)
				return this.scriptsContext.selfCare.goHome()
			case 'assignedWork': {
				const assignedTile = this.assignedAlveolus?.tile
				const assignedJob = assignedTile?.content?.getJob?.(this)
				if (!assignedTile || !assignedJob) return false
				const isSameTile =
					axial.key(toAxialCoord(assignedTile.position)!) ===
					axial.key(toAxialCoord(this.position)!)
				const path = isSameTile
					? []
					: this.game.hex.findPathForCharacter(
							this.position,
							assignedTile.position,
							this,
							maxWalkTime,
							false
						)
				if (!path) return false
				if (!('vehicleUid' in assignedJob)) this.releaseVehicleBeforeNonVehicleActivity(kind)
				this.log('character.beginJob', assignedJob.job)
				return this.workExecution(assignedJob, assignedTile, path)
			}
			case 'bestWork':
				if (this.assignedAlveolus) {
					const assigned = this.assignedAlveolus
					const assignedJob = assigned.tile?.content?.getJob?.(this)
					// Stay pinned while the assigned alveolus still has actionable work.
					if (assignedJob) return false
					// If assignment is idle, release it so the worker can pick pending hive work
					// (e.g. another convey source in the same hive).
					if (assigned.assignedWorker === this) assigned.assignedWorker = undefined
					this.assignedAlveolus = undefined
				}
				return this.findBestJob()
			case 'wander':
				this.releaseVehicleBeforeNonVehicleActivity(kind)
				return this.scriptsContext.selfCare.wander()
			default:
				return undefined
		}
	}
	/**
	 * **Active transport storage** while {@link driving}: the operated {@link VehicleEntity}'s
	 * `storage`. `undefined` when walking — there is no walking goods buffer. Prefer
	 * {@link requireActiveTransportStorage} at freight/transfer call sites that must have stock;
	 * see `sandbox/roadmap-no-character-inventory.md`.
	 */
	get carry(): Storage | undefined {
		return this.driving ? this.operates?.storage : undefined
	}

	/**
	 * Transport storage linked to the operated vehicle, even while temporarily offboard but still in
	 * control of that vehicle (zone browse).
	 */
	get transportStorage(): Storage | undefined {
		return this.operates?.storage
	}

	/**
	 * Resolves {@link carry} and asserts it is present. Use in code paths that only make sense on
	 * an operated vehicle (line freight load/unload/provide, gate drops, etc.).
	 */
	requireActiveTransportStorage(): Storage {
		const s = this.carry
		assert(s, `${this.name}: active transport storage requires driving with an operated vehicle`)
		return s
	}

	/**
	 * Resolves {@link transportStorage}. Unlike {@link requireActiveTransportStorage}, this also
	 * works while stepped off but still controlling the same vehicle during a zone browse transfer.
	 */
	requireTransportStorage(): Storage {
		const s = this.transportStorage
		assert(s, `${this.name}: transport storage requires an operated vehicle`)
		return s
	}

	/** Engine-rules `transferTime` for grab/drop durations (operated world vehicle when driving). */
	get freightTransferTime(): number {
		if (this.operates) {
			return vehicleRules[this.operates.vehicleType as keyof typeof vehicleRules].transferTime
		}
		/** Walking grab/drop step duration when not operating a line vehicle. */
		return 1.5
	}

	/** Applied to tile walk duration in `WalkFunctions.moveTo` when driving (wheelbarrow > 1 => slower). */
	get mobilityMultiplier(): number {
		if (!this.driving || !this.operates) return 1
		return vehicleRules[this.operates.vehicleType as keyof typeof vehicleRules].walkTime
	}

	serialize() {
		return {
			uid: this.uid,
			name: this.name,
			position: this.position,
			stats: {
				hunger: this.hunger,
				fatigue: this.fatigue,
				tiredness: this.tiredness,
			},
			assignedAlveolus: this.assignedAlveolus
				? {
						q: (this.assignedAlveolus.tile.position as any).q,
						r: (this.assignedAlveolus.tile.position as any).r,
					} // Save coordinate of alveolus
				: undefined,
			operatedVehicleUid: this.operates?.uid,
			driving: this.driving,
			scripts: (this as any).getScriptState(), // Access mixin method
		}
	}

	static deserialize(game: Game, data: any): Character {
		// Character creation logic similar to constructor but setting UID
		const char = new Character(game, data.uid, data.name, data.position)

		// Restore Stats
		char.hunger = data.stats.hunger
		char.fatigue = data.stats.fatigue
		char.tiredness = data.stats.tiredness

		// Legacy saves may include `inventory`; ignore (goods were never re-applied after removal).
		void data.inventory

		// Restore Scripts (after Character is created and context is available)
		// We need to defer assignments that depend on other objects (e.g. Alveolus)?
		// Or assume alveoli are already loaded.
		// Alveoli are loaded in Game.generate -> loadGeneratedBoard -> applyHivesPatches.
		// Population is loaded AFTER board. So Alveolus should exist.
		if (data.assignedAlveolus) {
			const tile = game.hex.getTile(data.assignedAlveolus)
			if (tile?.content && 'hive' in tile.content) {
				char.assignedAlveolus = tile.content as Alveolus
			}
		}
		if (data.operatedVehicleUid) {
			const vehicle = game.vehicles.vehicle(data.operatedVehicleUid)
			if (vehicle) {
				char.operates = vehicle
				if (data.driving) char.onboard()
			}
		}

		// Restore Scripts
		if (data.scripts) {
			;(char as any).restoreScriptState(data.scripts)
		}

		return char
	}
}

gameIsaTypes.character = (value: any) => {
	return value instanceof Character
}
