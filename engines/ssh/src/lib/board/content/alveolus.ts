import { configurations, harvestFatiguePremium, jobBalance } from 'engine-rules'
import { inert, memoize, reactive, type ScopedCallback, unreactive, unwrap } from 'mutts'
import { isTileCoord } from 'ssh/board/tile-coord'
import { assert } from 'ssh/debug'
import type { Hive, MovementSelection, TrackedMovement } from 'ssh/hive/hive'
import { gameIsaTypes } from 'ssh/npcs/utils'
import type { Character } from 'ssh/population/character'
import type { Storage } from 'ssh/storage/storage'
import type { GoodType, Job } from 'ssh/types/base'
import { type AxialCoord, axial, tileSize } from 'ssh/utils'
import type { ExchangePriority, GoodsRelations } from 'ssh/utils/advertisement'
import { toAxialCoord, toWorldCoord } from 'ssh/utils/position'
import { AlveolusGate } from '../border/alveolus-gate'
import type { Tile } from '../tile'
import { TileContent } from './content'
import { UnBuiltLand } from './unbuilt-land'
import { GcClassed } from './utils'

//reactiveOptions.maxEffectChain = 1000

@unreactive('tile', 'hive')
@reactive
export abstract class Alveolus extends GcClassed<Ssh.AlveolusDefinition, typeof TileContent>(
	TileContent
) {
	private _assignedWorker: Character | undefined
	public get assignedWorker(): Character | undefined {
		return this._assignedWorker
	}
	public set assignedWorker(value: Character | undefined) {
		const normalize = (v: Character | undefined) => (v === undefined ? undefined : unwrap(v))
		value = normalize(value)
		const current = normalize(this._assignedWorker)
		if (value === current) return
		assert(!value !== !this._assignedWorker, 'assigned worker mismatch')
		this._assignedWorker = value
	}
	public tile: Tile
	public declare hive: Hive
	public storage: Storage
	// Configurable properties removed - walkway and conveyor are no longer used
	public advertisingEffect?: ScopedCallback

	/**
	 * Reference to which configuration scope to use.
	 * Default is hive scope.
	 */
	public configurationRef: Ssh.ConfigurationReference = { scope: 'hive' }

	/**
	 * Individual configuration for this specific alveolus.
	 * Takes priority when configurationRef.scope is 'individual'.
	 */
	public individualConfiguration: Ssh.BaseAlveolusConfiguration | undefined

	/**
	 * Resolve and return the effective configuration for this alveolus.
	 * Priority: individual > named > hive > default
	 */
	get configuration(): Ssh.BaseAlveolusConfiguration {
		const { scope } = this.configurationRef

		if (scope === 'individual') {
			return (
				this.individualConfiguration ?? (configurations.default as Ssh.BaseAlveolusConfiguration)
			)
		}

		if (scope === 'named') {
			const name = this.configurationRef.name
			if (name) {
				const namedConfig = this.game.configurationManager.getNamedConfiguration(
					this.name as any,
					name
				)
				if (namedConfig) return namedConfig as Ssh.BaseAlveolusConfiguration
			}
			// Named config not found, fall back to hive
		}

		// Default to hive scope (also handles 'hive' case and fallback from named)
		const hiveConfig = this.hive?.configurations && unwrap(this.hive.configurations).get(this.name)
		if (hiveConfig) return hiveConfig as Ssh.BaseAlveolusConfiguration
		return configurations.default as Ssh.BaseAlveolusConfiguration
	}

	/** Whether this alveolus is working (derived from configuration) */
	get working(): boolean {
		return this.configuration.working && this.hive.working
	}

	/** Set working status by updating individual configuration */
	set working(value: boolean) {
		// Short-circuit if value is already the same
		if (this.configuration.working === value) return

		// Set scope to individual if needed (do this first to batch changes)
		if (this.configurationRef.scope !== 'individual') {
			this.configurationRef = { scope: 'individual' }
		}
		if (!this.individualConfiguration) {
			this.individualConfiguration = reactive({
				...(configurations.default as Ssh.BaseAlveolusConfiguration),
			})
		}
		this.individualConfiguration.working = value
	}

	constructor(tile: Tile, storage: Storage) {
		const tileCoord = toAxialCoord(tile.position)!
		super(tile.board.game, `alveolus:${tileCoord.q},${tileCoord.r}`)
		this.storage = storage
		this.tile = tile

		// Building gates will now happen during hive attachment
	}

	/**
	 * Default implementation - alveoli that don't override this cannot give goods
	 */
	canGive(_goodType: GoodType, _priority: ExchangePriority): boolean {
		return false
	}

	/**
	 * Default implementation - alveoli that don't override this cannot take goods
	 */
	canTake(_goodType: GoodType, _priority: ExchangePriority): boolean {
		return false
	}

	get debugInfo(): Record<string, any> {
		return {
			aGoodMovement: this.aGoodMovement?.map(
				(selection) => `${selection.movement.goodType} from ${axial.key(selection.fromSnapshot)}`
			),
			incomingGoods: this.incomingGoods,
		}
	}
	get walkTime() {
		return 1
	}
	get background() {
		return `terrain.${this.tile.terrainState?.terrain ?? this.tile.baseTerrain ?? 'grass'}`
	}
	get gates(): AlveolusGate[] {
		return this.tile.surroundings
			.map((b) => b.border.content)
			.filter((b): b is AlveolusGate => b instanceof AlveolusGate)
	}

	// Render tile background, alveolus sprite + a vertical goods bar on the right side of the tile

	colorCode() {
		return { tint: 0xffffff, borderColor: 0xffff00 }
	}

	canInteract(_action: string): boolean {
		// Alveoli can't be built on (they already exist)
		return false
	}

	// REHABILITATED MEMOIZE
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
		return inert(() => {
			const assignedWorker = this.assignedWorker ? unwrap(this.assignedWorker) : undefined
			const currentCharacter = character ? unwrap(character) : undefined
			if (assignedWorker && assignedWorker !== currentCharacter) {
				return undefined
			}
			const carry = this.conveyJob()
			if (carry) return carry

			// Only provide alveolus-specific jobs if working is enabled
			if (!this.working) {
				return undefined
			}

			return this.nextJob?.(character)
		})
	}

	getFatigueCost(): number {
		// Base fatigue based on action type
		const baseFatigue =
			this.action.type === 'harvest' ? this.workTime + harvestFatiguePremium : this.workTime

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
	get aGoodMovement(): MovementSelection[] | undefined {
		const hive = this.hive
		const here = toAxialCoord(this.tile.position)!
		const blocked: MovementSelection[] = []

		function canAdvance(mg: TrackedMovement) {
			if (mg.path.length === 0) return false
			const nextStep = mg.path[0]
			const storage = hive.storageAt(nextStep)
			if (!storage) return false
			// Final hop onto the demander tile: room is already represented by the twin target allocation.
			if (mg.path.length === 1 && isTileCoord(nextStep)) return true
			return storage.hasRoom(mg.goodType) > 0
		}
		const borderKeys = new Set(
			this.tile.surroundings.map(({ border }) => axial.key(toAxialCoord(border.position)!))
		)
		const canHandleFromHere = (from: AxialCoord, to: AxialCoord) => {
			const fromKey = axial.key(from)
			const toKey = axial.key(to)
			const hereKey = axial.key(here)
			if (fromKey === hereKey) return borderKeys.has(toKey)
			if (!borderKeys.has(fromKey)) return false
			if (toKey === hereKey) return true
			return borderKeys.has(toKey)
		}
		function selectMovement(
			movement: TrackedMovement,
			fromSnapshot: AxialCoord
		): MovementSelection {
			return {
				fromSnapshot,
				movement,
			}
		}

		// Deterministic priority: border-tracked movements before tile-center (several can exist per tile).
		// Collect movements from surroundings (borders)
		for (const { border } of this.tile.surroundings) {
			const from = toAxialCoord(border.position)!
			const arr = hive.movingGoods.get(from)
			if (!arr) {
				continue
			}
			for (const mg of arr) {
				if (mg.claimed) continue
				if (
					hive.queueBrokenMovementDiscard(mg, {
						expectedFrom: from,
						warnLabel: '[aGoodMovement] Invalid border movement',
					}) &&
					mg.path.length
				) {
					if (canHandleFromHere(from, mg.path[0]!)) {
						const selection = selectMovement(mg, mg.from ?? from)
						if (canAdvance(mg)) {
							return [selection]
						} else {
							blocked.push(selection)
						}
					}
				}
			}
		}

		// Collect movements at the tile itself
		const atHere = hive.movingGoods.get(here)
		if (atHere) {
			for (const mg of atHere) {
				if (mg.claimed) continue
				if (
					!hive.queueBrokenMovementDiscard(mg, {
						expectedFrom: here,
						warnLabel: '[aGoodMovement] Invalid tile movement',
					})
				) {
					continue
				}
				if (mg.path.length === 0) continue
				if (!canHandleFromHere(here, mg.path[0]!)) continue
				const selection = selectMovement(mg, mg.from ?? here)
				if (canAdvance(mg)) {
					return [selection]
				} else {
					blocked.push(selection)
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
	private findCircularBlock(blocked: MovementSelection[]): MovementSelection[] | undefined {
		// Build a map from current position to movements
		const movementsByPosition = new Map<string, MovementSelection[]>()

		for (const mg of blocked)
			if (mg.movement.path.length) {
				const key = `${mg.fromSnapshot.q},${mg.fromSnapshot.r}`
				if (!movementsByPosition.has(key)) {
					movementsByPosition.set(key, [])
				}
				movementsByPosition.get(key)!.push(mg)
			}

		// Try to find a cycle starting from each blocked movement
		const visited = new Set<string>()
		const recursionStack = new Set<string>()
		const path: MovementSelection[] = []

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
		function depthFirstSearchForCycle(mg: MovementSelection): MovementSelection[] | undefined {
			if (mg.movement.path.length === 0) return undefined
			const currentKey = `${mg.fromSnapshot.q},${mg.fromSnapshot.r}`
			const nextKey = `${mg.movement.path[0].q},${mg.movement.path[0].r}`

			visited.add(currentKey)
			recursionStack.add(currentKey)
			path.push(mg)

			// Check if next position creates a cycle (back edge detected)
			if (recursionStack.has(nextKey)) {
				// Found a cycle! Extract the cycle from path
				const cycleStart = path.findIndex(
					(m) => `${m.movement.path[0].q},${m.movement.path[0].r}` === nextKey
				)
				return path.slice(cycleStart)
			}

			// Explore movements from the next position
			const nextMovements = movementsByPosition.get(nextKey) || []
			for (const nextMg of nextMovements) {
				const nextNextKey = `${nextMg.fromSnapshot.q},${nextMg.fromSnapshot.r}`
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
		for (const mg of blocked)
			if (mg.movement.path.length) {
				const key = `${mg.fromSnapshot.q},${mg.fromSnapshot.r}`
				if (!visited.has(key)) {
					const cycle = depthFirstSearchForCycle(mg)
					if (cycle) return cycle
				}
			}

		return undefined
	}

	get incomingGoods(): boolean {
		return this.hive.hasIncomingMovementFor(this)
	}

	private conveyJob(): Job | undefined {
		if (!this.aGoodMovement?.length && !this.incomingGoods) return undefined

		return {
			job: 'convey',
			fatigue: 1,
			urgency: jobBalance.convey,
		}
	}

	// Called even when replacing a Building construction site
	destroy() {
		this.advertisingEffect?.()
		this.advertisingEffect = undefined
		this.destroyed = true
		super.destroy()
	}
	// Not yet called (bulldozed alveolus)
	deconstruct() {
		for (const gate of this.gates) gate.border.content = undefined
		this.tile.content = new UnBuiltLand(
			this.tile,
			this.tile.terrainState?.terrain ?? this.tile.baseTerrain ?? 'grass'
		)
		this.hive.removeAlveolus(this)
	}

	// TODO: @memoize() - First, check if it's worth, second, make sure all changes bring recomputation
	get neighborAlveoli(): Alveolus[] {
		return this.tile.neighborTiles
			.map((neighbor) => neighbor?.content)
			.filter((c): c is Alveolus => c instanceof Alveolus)
	}
	abstract get workingGoodsRelations(): GoodsRelations
	get goodsRelations(): GoodsRelations {
		const rv = this.working
			? this.workingGoodsRelations
			: Object.fromEntries(
					Object.keys(this.storage.stock).map((goodType) => [
						goodType as GoodType,
						{
							advertisement: 'provide',
							priority: '0-store' as ExchangePriority,
						},
					])
				)
		return rv ?? {}
	}
	/**
	 * Clean up the alveolus by creating loose goods for each item in storage
	 * and then emptying the storage. Goods are placed at random positions on the tile.
	 */
	cleanUp(): void {
		// TODO: cancel all movements
		// Get all goods currently in storage
		const stock = this.storage.stock
		const { x: tileX, y: tileY } = toWorldCoord(this.tile.position)!
		// Create loose goods for each item in storage
		for (const [goodType, quantity] of Object.entries(stock)) {
			if (quantity > 0) {
				// Create individual loose goods (one per unit)
				for (let i = 0; i < quantity; i++) {
					// Generate random position within the tile
					const { x, y } = axial.randomPositionInTile(this.game.random, tileSize)

					// Add the loose good to the tile
					this.tile.board.looseGoods.add(this.tile.position, goodType as GoodType, {
						position: { x: tileX + x, y: tileY + y },
					})
				}

				// Remove all of this good type from storage
				this.storage.removeGood(goodType as GoodType, quantity)
			}
		}
	}

	/**
	 * Clean up a specific good type from storage by creating loose goods
	 * @param goodType - The type of good to clean up
	 */
	cleanUpGood(goodType: GoodType): void {
		const quantity = this.storage.stock[goodType]
		if (!quantity) return

		const { x: tileX, y: tileY } = toWorldCoord(this.tile.position)!

		for (let i = 0; i < quantity; i++) {
			const { x, y } = axial.randomPositionInTile(this.game.random, tileSize)
			this.tile.board.looseGoods.add(this.tile.position, goodType, {
				position: { x: tileX + x, y: tileY + y },
			})
		}

		this.storage.removeGood(goodType, quantity)
	}
}
gameIsaTypes.alveolus = (value: any) => {
	return value instanceof Alveolus
}
