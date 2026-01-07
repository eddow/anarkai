import { reactive, type ScopedCallback } from 'mutts'
import { ColorMatrixFilter, Container, Sprite } from 'pixi.js'
import { characterEvolutionRates, characterTriggerLevels, maxWalkTime } from '$assets/constants'
import { goods as goodsCatalog } from '$assets/game-content'
import { assert, namedEffect } from '$lib/debug'
import { mrg } from '$lib/globals'
import type { GoodType, Job, WorkPlan } from '$lib/types/base'
import { type AxialCoord, axial, maxBy, type Positioned } from '$lib/utils'
import { axialDistance, type Position, toAxialCoord, toWorldCoord } from '../../utils/position'
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
import { type ScriptExecution, subject } from '../npcs/scripts'
import { GameObject, withGenerator, withInteractive, withTicked } from '../object'
import { renderTileGoods } from '../storage/goods-renderer'
import { Vehicle } from './vehicle/vehicle'

@reactive
export class Character extends withInteractive(
	withScripted(withTicked(withGenerator(GameObject))),
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
		this._tile = game.hex.getTile(toAxialCoord(this.position))!
		// Allocate initial occupancy on the board
		const queueStep = this.game.hex.moveCharacter(this, toAxialCoord(this._tile.position))
		assert(!queueStep, 'Character must not be queuing on creation')
		if (queueStep) this.stepExecutor = queueStep

		// Create vehicle (by hands for now) - direct instantiation like Tile->TileContent
		this.vehicle = new Vehicle.class['by-hands'](this)
	}

	/** Attempt to step onto a tile, managing board occupancy. */
	stepOn(tile: Tile) {
		if (axialDistance(this.position, tile.position) > 1.1) return false
		const to = toAxialCoord(tile.position)
		const from = toAxialCoord(this._tile.position)
		const queue = this.game.hex.moveCharacter(this, to, from)
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
		const start = toAxialCoord(this.position)

		// Cache jobs computed during scoring to avoid recomputing
		const jobCache = new Map<string, Job>()

		// Score function: evaluates how good a job is at a given coordinate
		const scoreJob = (coord: Positioned): number | false => {
			const tile = this.game.hex.getTile(coord)
			if (!tile) return false
			const job = tile.getJob?.(this) // Pass character to compute full job with path
			if (!job) return false

			// Cache the job for later retrieval
			const key = `${(coord as AxialCoord).q},${(coord as AxialCoord).r}`
			jobCache.set(key, job)

			return calculateJobScore(this, job)
		}

		// Find the best job using the findBest pathfinding function
		const path = this.game.hex.findBestForCharacter(
			start,
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
			target: target as any,
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
			Object.entries(this.carry.stock) as [GoodType, number][],
			([goodType]) =>
				(this.carry.available(goodType) > 0 &&
					'feedingValue' in goodsCatalog[goodType] &&
					(goodsCatalog[goodType].feedingValue as number)) ||
				undefined,
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

		if (Object.values(this.carry.stock).some((qty) => qty > 0)) {
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

	render(): ScopedCallback | undefined {
		const { game } = this

		// Create a container to keep character and vehicle together
		const group = new Container()

		// Create character sprite
		const characterSprite = new Sprite(game.getTexture('character'))
		characterSprite.anchor.set(0.5, 0.5)
		game.hex.resizeSprite(characterSprite, 1.2)
		group.addChild(characterSprite)

		// Create vehicle sprite (by hands)
		const vehicleSprite = new Sprite(game.getTexture('vehicles.byHands'))
		vehicleSprite.anchor.set(0.5, 0.5)
		// Slightly smaller than character and offset down a bit
		game.hex.resizeSprite(vehicleSprite, 0.9)
		vehicleSprite.position.set(0, characterSprite.height * 0.15)
		group.addChild(vehicleSprite)

		// Hover highlight similar to tiles
		const brightnessFilter = new ColorMatrixFilter()
		characterSprite.filters = [brightnessFilter]
		const mouseoverEffect = namedEffect('character.mouseover', () => {
			if (mrg.hoveredObject === this) {
				characterSprite.tint = 0xaaaaff
				brightnessFilter.brightness(1.2, false)
			} else {
				characterSprite.tint = 0xffffff
				brightnessFilter.brightness(1, false)
			}
		})
		const positionEffect = namedEffect('character.position', () => {
			const { x, y } = toWorldCoord(this.position)
			group.position.set(x, y)
		})

		// Vehicle-specific effect hook (reserved for future state-driven visuals)
		const vehicleEffect = namedEffect('character.vehicle', () => {
			// In the future, react to vehicle changes (e.g., carried goods) and update sprite
			void vehicleSprite
		})

		// Add to characters layer
		game.charactersLayer.addChild(group)

		// Render the vehicle's goods inside the group; smaller, centered, lower half, above vehicle
		const goodsCleanup = renderTileGoods(
			game,
			characterSprite.height * 0.7,
			() => this.carry.renderedGoods(),
			{ x: 0, y: characterSprite.height * 0.15 }, // relative to group center
			group,
		)

		// Return cleanup function
		return () => {
			mouseoverEffect()
			positionEffect()
			vehicleEffect()
			goodsCleanup?.()
			group.destroy({ children: true })
			game.charactersLayer.removeChild(group)
		}
	}
	get carry(): Storage {
		return this.vehicle.storage
	}
}
