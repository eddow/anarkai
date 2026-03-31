import { inert, reactive, unwrap } from 'mutts'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import { assert } from 'ssh/debug'
import type { Game } from 'ssh/game'
import type { Storage } from 'ssh/storage'
import type { GoodType, Job, WorkPlan } from 'ssh/types/base'
import { type AxialCoord, axial, maxBy, type Positioned } from 'ssh/utils'
import { axialDistance, type Position, toAxialCoord } from 'ssh/utils/position'
import {
	characterEvolutionRates,
	characterTriggerLevels,
	maxWalkTime,
} from '../../../assets/constants'
import { goods as goodsCatalog } from '../../../assets/game-content'

// Simple job scoring functions
function calculateJobScore(_character: Character, job: Job): number {
	return job.urgency
}
function bestPossibleJobScore(_character: Character): number {
	return Number.POSITIVE_INFINITY
}

import { GameObject, withInteractive, withTicked } from 'ssh/game/object'
import { gameIsaTypes } from 'ssh/npcs'
import aCharacterContext from 'ssh/npcs/context'
import { withScripted } from 'ssh/npcs/object'
import type { ScriptExecution } from 'ssh/npcs/scripts'
import { Vehicle } from './vehicle/vehicle'

@reactive
export class Character extends withInteractive(withScripted(withTicked(GameObject))) {
	readonly triggerLevels = characterTriggerLevels

	// Character needs levels (starting at 0, incrementing 1 per second)
	public hunger: number = 0
	public tiredness: number = 0
	public fatigue: number = 0

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
		const workPlan: WorkPlan = {
			...job,
			type: 'work',
			target,
		}
		return this.scriptsContext.work.goWork(workPlan, path)
	}

	/**
	 * Find the best available job using pathfinding
	 * @returns Object with job, tile, and path, or false if no job found
	 */
	findBestJob(): ScriptExecution | false {
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

			this.log('character.beginJob', job.job)
			return this.workExecution(job, targetTile, selectedPath)
		})
	}

	get keepWorking(): boolean {
		return (
			this.hunger < this.triggerLevels.hunger.high &&
			this.fatigue < this.triggerLevels.fatigue.high /*&&
			this.tiredness < this.triggerLevels.tiredness.high*/
		)
	}

	get carriedFood(): GoodType | undefined {
		return maxBy(
			Object.entries(this.carry.availables) as [GoodType, number][],
			([goodType, available]) => {
				const feedingValue = (goodsCatalog[goodType] as any).feedingValue
				if (!feedingValue || available < 1) return undefined

				return feedingValue as number
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

	// Update character needs levels based on time elapsed
	update(deltaSeconds: number) {
		const activity: Ssh.ActivityType = (this.stepExecutor?.type ?? 'idle') as Ssh.ActivityType
		const hungerRate =
			characterEvolutionRates.hunger[activity] ?? characterEvolutionRates.hunger['*'] ?? 0
		const tirednessRate =
			characterEvolutionRates.tiredness[activity] ?? characterEvolutionRates.tiredness['*'] ?? 0
		const fatigueRate =
			characterEvolutionRates.fatigue[activity] ?? characterEvolutionRates.fatigue['*'] ?? 0
		this.hunger += hungerRate * deltaSeconds
		this.tiredness += tirednessRate * deltaSeconds
		this.fatigue += fatigueRate * deltaSeconds
		super.update(deltaSeconds)
	}

	findAction() {
		return inert(() => {
			if (this.hunger > this.triggerLevels.hunger.high) return this.scriptsContext.selfCare.goEat()

			if (Object.values(this.carry.availables).some((qty) => qty! > 0)) {
				if (this.scriptsContext.find.freeSpot()) {
					return this.scriptsContext.inventory.dropAllLoose()
				}
			}
			let tryAnActivity: ScriptExecution | false | undefined
			if (this.fatigue < this.triggerLevels.fatigue.high) {
				const assignedTile = this.assignedAlveolus?.tile
				const assignedJob = assignedTile?.content?.getJob?.(this)
				if (assignedTile && assignedJob) {
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
					if (path) return this.workExecution(assignedJob, assignedTile, path)
				}
				tryAnActivity = this.findBestJob()
			}

			return tryAnActivity || this.scriptsContext.selfCare.wander()
		})
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
