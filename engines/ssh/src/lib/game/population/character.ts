import { reactive, type ScopedCallback } from 'mutts'
import { characterEvolutionRates, characterTriggerLevels, maxWalkTime } from '$assets/constants'
import { goods as goodsCatalog } from '$assets/game-content'
import { assert, namedEffect } from '$lib/debug'
import { mrg } from '$lib/interactive-state'
import type { GoodType, Job, WorkPlan } from '$lib/types/base'
import { type AxialCoord, axial, maxBy, type Positioned } from '$lib/utils'
import { axialDistance, type Position, toAxialCoord } from '../../utils/position'
import type { Alveolus } from '../board/content/alveolus'
import type { Tile } from '../board/tile'
import type { Game } from '../game'
import type { Storage } from '../storage'

// Simple job scoring functions
function calculateJobScore(_character: Character, job: Job): number {
	return job.urgency
}
function bestPossibleJobScore(_character: Character): number {
	return 3
}

import aCharacterContext from '../npcs/context'
import { withScripted } from '../npcs/object'
// biome-ignore lint/correctness/noUnusedImports: We need `subject` for mixins tranquility: all propertyKeys are known
import { type ScriptExecution } from '../npcs/scripts'
import { gameIsaTypes } from '../npcs/utils'
import { GameObject, withInteractive, withTicked } from '../object'
import { Vehicle } from './vehicle/vehicle'

@reactive
export class Character extends withInteractive(
	withScripted(withTicked(GameObject)),
) {
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
		if (value === this._assignedAlveolus) return
		assert(!value !== !this._assignedAlveolus, 'assigned alveolus mismatch')
		this._assignedAlveolus = value
	}

	// Character vehicle (like Tile has content)
	public vehicle: Vehicle
	private _scriptsContext?: any
	public get scriptsContext() {
		return this._scriptsContext ??= aCharacterContext(this)
	}
	private _tile!: Tile

	get tile(): Tile {
		return this._tile
	}

	constructor(
		game: Game,
		uid: string,
		public name: string,
		public position: Position,
	) {
		super(game, uid)
        const ax = toAxialCoord(this.position)
		this._tile = game.hex.getTile({ q: Math.round(ax.q), r: Math.round(ax.r) })!
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

	/**
	 * Find the best available job using pathfinding
	 * @returns Object with job, tile, and path, or false if no job found
	 */
	findBestJob(): ScriptExecution | false {
        // console.error(`[${this.uid}] findBestJob called`);
		const start = toAxialCoord(this.position)

		// Cache jobs computed during scoring to avoid recomputing
		const jobCache = new Map<string, Job>()

		// Score function: evaluates how good a job is at a given coordinate
		const scoreJob = (coord: Positioned): number | false => {
			const tile = this.game.hex.getTile(coord)
			if (!tile) return false
            
			const job = tile.getJob?.(this) // Pass character to compute full job with path
            const axCoord = toAxialCoord(coord)!
            const coordKey = axial.key(axCoord);
			if (!job) {
                // if (axial.distance(axCoord, start) < 2) console.log(`[scoreJob] ${this.name} at ${coordKey}: no job`);
                return false
            }

			// Cache the job for later retrieval
			const key = coordKey
			jobCache.set(key, job)

			const score = calculateJobScore(this, job)
            //console.log(`[scoreJob] ${this.name} at ${coordKey}: job ${job.job}, score ${score}`);
            return score
		}

		// Find the best job using the findBest pathfinding function
		const path = this.game.hex.findBestForCharacter(
			this.position,
			this,
			scoreJob,
			maxWalkTime, // Use maxWalkTime from constants
			bestPossibleJobScore(this),
			true, // punctual: only consider exact coordinates
		)

		if (!path || path.length === 0) return false

		const targetCoord = path[path.length - 1] as AxialCoord
		const key = `${targetCoord.q},${targetCoord.r}`
		const job = jobCache.get(key)!

		const targetTile = this.game.hex.getTile(targetCoord)!
		const jobProvider = targetTile.content!

		this.log('character.beginJob', job.job)

		// Job already has all details (path, urgency, fatigue) from cached getJob()
		// Just create WorkPlan by adding plan type and target
		const target = job.job === 'offload' ? targetTile : jobProvider
		const workPlan: WorkPlan = {
			...job,
			type: 'work',
			target: target,
		}
		return this.scriptsContext.work.goWork(workPlan, path)
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
				if (!feedingValue || available < 0.1) return undefined
				
				if (available < 0.9) {
					// Only log if it's a significant decay that we are about to eat
					this.log('character.eatingFractional', { goodType, available })
				}

				return feedingValue as number
			},
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
		if (this.hunger > this.triggerLevels.hunger.high) return this.scriptsContext.selfCare.goEat()

		if (Object.values(this.carry.availables).some((qty) => qty! > 0)) {
			// Only try to drop if we can find a spot to drop them
			if (this.scriptsContext.find.freeSpot()) {
				return this.scriptsContext.inventory.dropAllFree()
			}
		}
		const tryAnActivity =
			this.fatigue < this.triggerLevels.fatigue.high ? this.findBestJob() : undefined // goRest
        
		// Default to wandering when no specific action is needed
		return tryAnActivity || this.scriptsContext.selfCare.wander()
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
			if (tile && tile.content && 'hive' in tile.content) {
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
