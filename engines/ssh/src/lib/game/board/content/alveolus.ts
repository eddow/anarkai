import { memoize, type ScopedCallback, unreactive } from 'mutts'

import { assert } from '$lib/debug'
import type { Hive, MovingGood } from '$lib/game/hive/hive'
import { gameIsaTypes } from '$lib/game/npcs/utils'
import type { Character } from '$lib/game/population/character'
import type { GoodType, Job } from '$lib/types/base'
import { type AxialCoord, axial, epsilon, tileSize } from '$lib/utils'
import type { GoodsRelations } from '$lib/utils/advertisement'
import { toAxialCoord, toWorldCoord } from '$lib/utils/position'

import { type Storage } from '../../storage'
import { AlveolusGate } from '../border/alveolus-gate'
import type { Tile } from '../tile'
import { TileContent } from './content'
import { UnBuiltLand } from './unbuilt-land'
import { GcClassed } from './utils'

//reactiveOptions.maxEffectChain = 1000
interface LocalMovingGood extends MovingGood {
	from: AxialCoord
}

@unreactive
export abstract class Alveolus extends GcClassed<Ssh.AlveolusDefinition, typeof TileContent>(
	TileContent,
) {
	declare readonly name: string

	#assignedWorker: Character | undefined
	public get assignedWorker(): Character | undefined {
		return this.#assignedWorker
	}
	public set assignedWorker(value: Character | undefined) {
		assert(!value !== !this.#assignedWorker, 'assigned worker mismatch')
		this.#assignedWorker = value
	}
	public tile: Tile
	public declare hive: Hive
	public storage: Storage
	// Configurable properties removed - walkway and conveyor are no longer used
	public advertisingEffect?: ScopedCallback
	public working: boolean = true

	constructor(tile: Tile, storage: Storage) {
		const tileCoord = toAxialCoord(tile.position)!
		super(tile.board.game, `alveolus:${tileCoord.q},${tileCoord.r}`)
		this.storage = storage
		this.tile = tile

		// Only create gates between two alveoli
		for (const surrounding of this.tile.surroundings) {
			// Check if the neighboring tile also contains an alveolus
			if (surrounding.tile instanceof Alveolus) {
				// Create gate only if one doesn't already exist
				if (!(surrounding.border.content instanceof AlveolusGate)) {
					surrounding.border.content = new AlveolusGate(surrounding.border)
				}
			}
		}
	}

	get debugInfo() {
		return {}
	}
	get walkTime() {
		return 1
	}
	get background() {
		return 'terrain.concrete'
	}
	get gates(): AlveolusGate[] {
		return this.tile.surroundings
			.map((b) => b.border.content)
			.filter((b): b is AlveolusGate => b instanceof AlveolusGate)
	}

	// Render tile background, alveolus sprite + a vertical goods bar on the right side of the tile
    
    colorCode() {
        return { tint: 0xffffff, borderColor: 0xFFFF00 }
    }


	canInteract(_action: string): boolean {
		// Alveoli can't be built on (they already exist)
		return false
	}

	@memoize
	get isBurdened(): boolean {
		// Only consider available (unreserved) goods for burden check
		// This prevents offering offload jobs for goods that are already being picked up
		const availableGoods = this.tile.availableGoods
		const coord = toAxialCoord(this.tile.position)!
		return availableGoods.length > 0 && !this.hive.movingGoods.get(coord)?.length
	}

	nextJob?(character?: Character): Job | undefined

	getJob(character?: Character): Job | undefined {
		if (this.assignedWorker) return undefined
		// If the alveolus is burdened by FreeGoods, ask to remove them
		if (this.isBurdened) {
			return {
				job: 'offload',
				urgency: 4, // High urgency to clear blockages
				fatigue: 1,
			} as Job
		}
		const carry = this.conveyJob()
		if (carry) return carry

		// Only provide alveolus-specific jobs if working is enabled
		if (!this.working) return undefined
		return this.nextJob?.(character)
	}

	getFatigueCost(): number {
		// Base fatigue based on action type
		const baseFatigue = this.action.type === 'harvest' ? this.workTime + 2 : this.workTime

		// Add time-based fatigue (if alveolus has time configuration)
		// For now, just return base fatigue
		return baseFatigue
	}

	/**
	 * Find a good movement or a cycle of blocked movements:
	 * - Returns a single movement (as singleton array) if one can advance
	 * - Returns a cycle of movements (A->B, B->C, C->A) if circular blockade detected
	 * - Returns undefined if no movements available
	 */
	@memoize
	get aGoodMovement(): LocalMovingGood[] | undefined {
		const hive = this.hive
		const here = toAxialCoord(this.tile.position)!
		const blocked: LocalMovingGood[] = []

		function canAdvance(mg: MovingGood) {
			const storage = hive.storageAt(mg.path[0])
			return storage?.hasRoom(mg.goodType) || mg.path.length === 1
		}
		// TODO: take a random movement or keep it arbitrary?
		// Collect movements at the tile itself
		const atHere = hive.movingGoods.get(here)
		if (atHere) {
			for (const mg of atHere) {
				const localMg = Object.setPrototypeOf({ from: here }, mg) as LocalMovingGood
				if (canAdvance(mg)) {
					return [localMg]
				} else {
					blocked.push(localMg)
				}
			}
		}

		// Collect movements from surroundings (borders)
		for (const { border } of this.tile.surroundings) {
			const from = toAxialCoord(border.position)!
			const arr = hive.movingGoods.get(from)
			if (!arr) continue
			for (const mg of arr) {
				if (axial.distance(mg.path[0], here) < 0.5 + epsilon) {
					const localMg = Object.setPrototypeOf({ from }, mg) as LocalMovingGood
					if (canAdvance(mg)) {
						return [localMg]
					} else {
						blocked.push(localMg)
					}
				}
			}
		}

		// No available movements - try to find circular blocks
		if (blocked.length === 0) {
			return undefined
		}

		// Detect circular blockades using DFS
		const cycle = this.findCircularBlock(blocked)
		return cycle
	}

	/**
	 * Find a circular blockade in the list of blocked movements
	 * Returns the cycle as an array of movements, or undefined if no cycle found
	 */
	private findCircularBlock(blocked: LocalMovingGood[]): LocalMovingGood[] | undefined {
		// Build a map from current position to movements
		const movementsByPosition = new Map<string, LocalMovingGood[]>()

		for (const mg of blocked) {
			const key = `${mg.from.q},${mg.from.r}`
			if (!movementsByPosition.has(key)) {
				movementsByPosition.set(key, [])
			}
			movementsByPosition.get(key)!.push(mg)
		}

		// Try to find a cycle starting from each blocked movement
		const visited = new Set<string>()
		const recursionStack = new Set<string>()
		const path: LocalMovingGood[] = []

		/**
		 * Depth-First Search to detect cycles in the movement graph.
		 * Uses the recursion stack to detect back edges that indicate cycles.
		 *
		 * @param mg - The current movement being explored
		 * @returns The cycle as an array of movements if found, undefined otherwise
		 *
		 * Algorithm:
		 * - Tracks visited nodes to avoid re-exploring
		 * - Maintains recursion stack to detect back edges (cycles)
		 * - Builds path during traversal
		 * - When a back edge is found (next position is in recursion stack), extracts the cycle
		 * - Backtracks by removing from recursion stack and path when exploring branch completes
		 */
		function depthFirstSearchForCycle(mg: LocalMovingGood): LocalMovingGood[] | undefined {
			const currentKey = `${mg.from.q},${mg.from.r}`
			const nextKey = `${mg.path[0].q},${mg.path[0].r}`

			visited.add(currentKey)
			recursionStack.add(currentKey)
			path.push(mg)

			// Check if next position creates a cycle (back edge detected)
			if (recursionStack.has(nextKey)) {
				// Found a cycle! Extract the cycle from path
				const cycleStart = path.findIndex((m) => `${m.path[0].q},${m.path[0].r}` === nextKey)
				return path.slice(cycleStart)
			}

			// Explore movements from the next position
			const nextMovements = movementsByPosition.get(nextKey) || []
			for (const nextMg of nextMovements) {
				const nextNextKey = `${nextMg.from.q},${nextMg.from.r}`
				if (!visited.has(nextNextKey)) {
					const result = depthFirstSearchForCycle(nextMg)
					if (result) return result
				}
			}

			// Backtrack: remove from recursion stack and path
			recursionStack.delete(currentKey)
			path.pop()
			return undefined
		}

		// Try DFS from each unvisited blocked movement
		for (const mg of blocked) {
			const key = `${mg.from.q},${mg.from.r}`
			if (!visited.has(key)) {
				const cycle = depthFirstSearchForCycle(mg)
				if (cycle) return cycle
			}
		}

		return undefined
	}
	@memoize
	get incomingGoods(): boolean {
		if (
			this.tile.surroundings.some(
				(s) => s.border.content instanceof AlveolusGate && s.border.content.storage.allocatedSlots,
			)
		) {
			debugger
		}
		// Note: because borders have 2 neighbors and we check this when no movement is occurring,
		//  if a good is incoming, it's for you (you're in one of the neighbors)
		return this.tile.surroundings.some(
			(s) => s.border.content instanceof AlveolusGate && s.border.content.storage.allocatedSlots,
		)
	}

	private conveyJob(): Job | undefined {
		// Provide a convey job only when there are pass-through movements via borders
		// Now handles circular blockades - aGoodMovement will return a cycle to untangle
		return this.aGoodMovement ? ({ job: 'convey', fatigue: 3, urgency: 2 } as Job) : undefined
	}

	// Called even when replacing a Building construction site
	destroy() {
		this.advertisingEffect?.()
		this.advertisingEffect = undefined
		super.destroy()
	}
	// Not yet called (bulldozed alveolus)
	deconstruct() {
		for (const gate of this.gates) gate.border.content = undefined
		this.tile.content = new UnBuiltLand(this.tile, 'concrete')
		this.hive.removeAlveolus(this)
	}

	@memoize
	get neighborAlveoli(): Alveolus[] {
		return this.tile.neighborTiles
			.map((neighbor) => neighbor?.content)
			.filter((c): c is Alveolus => c instanceof Alveolus)
	}
	abstract get workingGoodsRelations(): GoodsRelations
	//@memoize
	get goodsRelations(): GoodsRelations {
		const rv = this.working
			? this.workingGoodsRelations
			: Object.fromEntries(
					Object.keys(this.storage.stock).map((goodType) => [
						goodType as GoodType,
						{ advertisement: 'provide', priority: '0-store' },
					]),
				)
		this.tile.log(`goodsRelations: ${JSON.stringify(rv)}`)
		return rv
	}
	/**
	 * Clean up the alveolus by creating free goods for each item in storage
	 * and then emptying the storage. Goods are placed at random positions on the tile.
	 */
	cleanUp(): void {
		// TODO: cancel all movements
		// Get all goods currently in storage
		const stock = this.storage.stock
		const { x: tileX, y: tileY } = toWorldCoord(this.tile.position)!
		// Create free goods for each item in storage
		for (const [goodType, quantity] of Object.entries(stock)) {
			if (quantity > 0) {
				// Create individual free goods (one per unit)
				for (let i = 0; i < quantity; i++) {
					// Generate random position within the tile
					const { x, y } = axial.randomPositionInTile(this.game.random, tileSize)

					// Add the free good to the tile
					this.tile.board.freeGoods.add(this.tile.position, goodType as GoodType, {
						position: { x: tileX + x, y: tileY + y },
					})
				}

				// Remove all of this good type from storage
				this.storage.removeGood(goodType as GoodType, quantity)
			}
		}
	}
}
gameIsaTypes.alveolus = (value: any) => {
	return value instanceof Alveolus
}
