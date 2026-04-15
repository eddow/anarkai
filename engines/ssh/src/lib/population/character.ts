import { goods as goodsCatalog } from 'engine-rules'
import { inert, reactive, unwrap } from 'mutts'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import { assert, traceIdleDiagnosis } from 'ssh/debug'
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
import type { GoodType, Job, WorkPlan } from 'ssh/types/base'
import { type AxialCoord, axial, maxBy, type Positioned } from 'ssh/utils'
import { axialDistance, type Position, toAxialCoord } from 'ssh/utils/position'
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

function roundDiagnosticValue(value: number): number {
	return Math.round(value * 1000) / 1000
}

import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { GameObject, withInteractive, withTicked } from 'ssh/game/object'
import { gameIsaTypes } from 'ssh/npcs'
import aCharacterContext from 'ssh/npcs/context'
import { withScripted } from 'ssh/npcs/object'
import type { ScriptExecution } from 'ssh/npcs/scripts'
import { releaseAllHomeReservations } from 'ssh/residential/housing-reservations'
import { Vehicle } from './vehicle/vehicle'

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

	// Character vehicle (like Tile has content)
	public vehicle: Vehicle
	private _scriptsContext?: any
	public get scriptsContext() {
		return (this._scriptsContext ??= aCharacterContext(this))
	}
	private _tile!: Tile

	get tile(): Tile {
		return this._tile
	}

	constructor(
		game: Game,
		uid: string,
		public name: string,
		public position: Position
	) {
		super(game, uid)
		const ax = toAxialCoord(this.position)
		this._tile = game.hex.getTile({
			q: Math.round(ax.q),
			r: Math.round(ax.r),
		})!
		// Allocate initial occupancy on the board
		const queueStep = this.game.hex.moveCharacter(this, this._tile.position)
		assert(!queueStep, 'Character must not be queuing on creation')
		if (queueStep) this.stepExecutor = queueStep

		// Create vehicle (by hands for now) - direct instantiation like Tile->TileContent
		this.vehicle = new Vehicle.class['by-hands'](this)
	}

	/** Attempt to step onto a tile, managing board occupancy. */
	stepOn(tile: Tile) {
		if (axialDistance(this.position, tile.position) > 1.1) return false
		const queue = this.game.hex.moveCharacter(this, tile.position, this._tile.position)
		if (queue)
			return queue.finished(() => {
				this._tile = tile
			})
		this._tile = tile
	}

	get title(): string {
		return this.name
	}

	private workExecution(job: Job, targetTile: Tile, path: AxialCoord[]): ScriptExecution {
		const jobProvider = targetTile.content!
		const target = job.job === 'offload' ? targetTile : jobProvider
		const safePath = path.filter((step): step is AxialCoord => !!step)
		const workPlan: WorkPlan = {
			...job,
			type: 'work',
			target,
		}
		return this.scriptsContext.work.goWork(workPlan, safePath)
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
			case 'offload':
				return `${job.looseGood.goodType} @ ${coord.q}, ${coord.r}`
			case 'defragment':
				return `${job.goodType} @ ${targetName}`
			case 'gather':
				return job.goodType ? `${job.goodType} @ ${targetName}` : targetName
			case 'freightDeliver':
				return `${job.goodType} freightDeliver @ ${coord.q}, ${coord.r}`
			default:
				return targetName
		}
	}

	private rankedWorkCandidates(): RankedWorkCandidate[] {
		return inert(() => {
			const candidates: RankedWorkCandidate[] = []
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
		if (candidate.job.job === 'offload' && match.job.job === 'offload') {
			return candidate.job.looseGood.goodType === match.job.looseGood.goodType
		}
		if (candidate.job.job === 'defragment' && match.job.job === 'defragment') {
			return candidate.job.goodType === match.job.goodType
		}
		if (candidate.job.job === 'gather' && match.job.job === 'gather') {
			return candidate.job.goodType === match.job.goodType
		}
		if (candidate.job.job === 'freightDeliver' && match.job.job === 'freightDeliver') {
			return (
				candidate.job.goodType === match.job.goodType &&
				axial.key(candidate.job.site) === axial.key(match.job.site) &&
				axial.key(candidate.job.bay) === axial.key(match.job.bay)
			)
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

	/**
	 * Resolve best job without starting a script (for planning / utility).
	 */
	resolveBestJobMatch(): { job: Job; targetTile: Tile; path: AxialCoord[] } | false {
		return inert(() => {
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
				if (!bestFallback) return false
				selectedPath = bestFallback.path
				match = { job: bestFallback.job, targetTile: bestFallback.targetTile }
			}
			const { job, targetTile } = match
			if (!selectedPath) {
				const isSameTile =
					axial.key(toAxialCoord(targetTile.position)!) === axial.key(toAxialCoord(this.position)!)
				if (!isSameTile) return false
				selectedPath = []
			}

			return { job, targetTile, path: selectedPath }
		})
	}

	/**
	 * Find the best available job using pathfinding
	 * @returns Object with job, tile, and path, or false if no job found
	 */
	findBestJob(): ScriptExecution | false {
		const match = this.resolveBestJobMatch()
		if (!match) return false
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

	get carriedFood(): GoodType | undefined {
		return maxBy(
			Object.entries(this.carry.availables) as [GoodType, number][],
			([goodType, available]) => {
				const def: Ssh.GoodsDefinition = goodsCatalog[goodType]
				if (!def.satiationStrength || available < 1) return undefined
				return def.satiationStrength
			}
		)?.[0]
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
				name: this.vehicle.name,
				storage: this.carry,
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

	private tryScriptForActivityKind(kind: NextActivityKind): ScriptExecution | false | undefined {
		switch (kind) {
			case 'eat':
				if (!(this.hunger > this.triggerLevels.hunger.satisfied)) return false
				return this.scriptsContext.selfCare.goEat()
			case 'home':
				if (this.keepWorking) return false
				return this.scriptsContext.selfCare.goHome()
			case 'drop':
				return this.scriptsContext.inventory.dropAllLoose()
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
				return this.scriptsContext.selfCare.wander()
			default:
				return undefined
		}
	}

	get carry(): Storage {
		return this.vehicle.storage
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
			inventory: this.carry.stock,
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

		// Restore Inventory
		for (const [good, qty] of Object.entries(data.inventory)) {
			char.carry.addGood(good as GoodType, qty as number)
		}

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
