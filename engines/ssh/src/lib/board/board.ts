import { defer, reactive } from 'mutts'
import type { Game } from 'ssh/game'
import { GameObject, withContainer, withHittable } from 'ssh/game/object'
import type { Hive } from 'ssh/hive/hive'
import { QueueStep } from 'ssh/npcs'
import type { Character } from 'ssh/population'
import {
	type AxialCoord,
	axial,
	findBest,
	findNearest,
	findPath,
	findReachable,
	fromCartesian,
	type NeighborInfo,
	type Positioned,
	type Scoring,
	tileSize,
	toAxialCoord,
} from 'ssh/utils'
import { AxialKeyMap } from 'ssh/utils/mem'
import { TileBorder, type TileBorderContent } from './border/border'
import { Alveolus } from './content/alveolus'
import type { TileContent } from './content/content'
import { UnBuiltLand } from './content/unbuilt-land'
import { LooseGoods } from './looseGoods'
import {
	canBuildRoadAcrossBorder,
	ROAD_WALK_TIME_MULTIPLIERS,
	type RoadSegment,
	type RoadType,
} from './roads'
import { Tile } from './tile'
import { isTileCoord } from './tile-coord'
import { ZoneManager } from './zone'

export { isTileCoord } from './tile-coord'

@reactive
export class HexBoard extends withContainer(withHittable(GameObject)) {
	private readonly contents = new AxialKeyMap<TileContent | TileBorderContent>()
	private readonly tileCache = new AxialKeyMap<Tile>()
	private readonly borderCache = new AxialKeyMap<TileBorder>()
	private readonly roadTypes = new AxialKeyMap<RoadType>()
	private readonly occupied = new AxialKeyMap<Character[]>([], () => [])
	private readonly pendingHiveRefresh = new Set<Hive>()
	private topologyRefreshScheduled = false
	readonly looseGoods: LooseGoods
	readonly zoneManager: ZoneManager

	get tiles(): Tile[] {
		const tiles: Tile[] = []
		for (const item of this.contents.values()) {
			if ('tile' in item) {
				tiles.push((item as TileContent).tile)
			}
		}
		return tiles
	}

	*tilesAround(center: Positioned, radius: number): Generator<Tile> {
		const centerCoord = toAxialCoord(center)
		if (!centerCoord) return
		const roundedCenter = axial.round(centerCoord)
		const tileRadius = Math.max(0, Math.floor(radius))
		for (const coord of axial.allTiles(roundedCenter, tileRadius)) {
			const content = this.contents.get(coord)
			const tile = content && 'tile' in content ? content.tile : this.tileCache.get(coord)
			if (tile) yield tile
		}
	}

	constructor(public game: Game) {
		super(game)
		this.looseGoods = new LooseGoods(game)
		this.zoneManager = new ZoneManager()
		this.zIndex = -1
	}

	hitTest(worldX: number, worldY: number, selectedAction?: string): any {
		const coord = axial.round(fromCartesian({ x: worldX, y: worldY }, tileSize))
		const tile = this.getTile(coord)
		if (!tile) return false
		if (selectedAction && !tile.canInteract(selectedAction)) {
			return false
		}
		return tile
	}

	inBound(coord: Positioned): boolean {
		const ax = toAxialCoord(coord)
		if (!ax) return false
		return true
	}
	getTileContent(ref: Positioned): TileContent | undefined {
		const coord = toAxialCoord(ref)
		if (!coord || !isTileCoord(coord)) return undefined
		return this.contents.get({ q: coord.q, r: coord.r }) as TileContent | undefined
	}

	setTileContent(ref: Positioned, content: TileContent | undefined) {
		const coord = toAxialCoord(ref)
		if (!coord || !isTileCoord(coord)) return
		const oldContent = this.contents.get({ q: coord.q, r: coord.r }) as TileContent | undefined
		const changedGroundSemantics =
			!!oldContent &&
			!!content &&
			oldContent instanceof UnBuiltLand !== content instanceof UnBuiltLand
		if (!content) this.contents.delete({ q: coord.q, r: coord.r })
		else this.contents.set({ q: coord.q, r: coord.r }, content)
		if (oldContent && oldContent !== content) {
			if (oldContent instanceof Alveolus) {
				oldContent.hive.detachAlveolusForRefresh(oldContent)
				this.markHiveTopologyDirty(oldContent.hive)
			}
			oldContent.destroy()
		}
		// If a tile content is set programmatically post-generation, mark tile dirty
		const tile = content?.tile ?? (coord ? this.getTile(coord) : undefined)
		if (tile && oldContent !== content) tile.notifyContentChanged()
		if (tile) tile.asGenerated = false
		if (tile) this.game.enqueueInteractiveChange(tile)
		if (changedGroundSemantics) {
			this.game.notifyGroundSemanticsChanged(coord)
		}
	}

	markHiveTopologyDirty(hive: Hive | undefined) {
		if (!hive || hive.isDestroyed) return
		hive.markTopologyRefreshPending()
		this.pendingHiveRefresh.add(hive)
		if (this.topologyRefreshScheduled) return
		this.topologyRefreshScheduled = true
		defer(() => {
			this.topologyRefreshScheduled = false
			this.flushHiveTopologyRefresh()
		})
	}

	flushHiveTopologyRefresh() {
		if (this.pendingHiveRefresh.size === 0) return
		const pending = new Set(Array.from(this.pendingHiveRefresh).filter((hive) => !hive.isDestroyed))
		this.pendingHiveRefresh.clear()
		if (pending.size === 0) return
		const [anchor] = pending
		anchor.flushTopologyRefreshBatch(pending)
	}

	getTile(ref: Positioned): Tile | undefined {
		const coord = toAxialCoord(ref)
		if (!coord || !isTileCoord(coord)) return undefined
		const content = this.contents.get(axial.round(coord)) as TileContent | undefined
		if (content?.tile) {
			this.tileCache.set(coord, content.tile)
			return content.tile
		}
		const cached = this.tileCache.get(coord)
		if (cached) return cached
		if (!this.inBound(coord)) return undefined
		const tile = this.game.withObjectRegistrationBatch(() => new Tile(this, coord))
		this.tileCache.set(coord, tile)
		return tile
	}

	getBorderContent(ref: Positioned): TileBorderContent | undefined {
		const coord = toAxialCoord(ref)
		if (!coord || isTileCoord(coord)) return undefined
		return this.contents.get({ q: coord.q, r: coord.r }) as TileBorderContent | undefined
	}
	setBorderContent(ref: Positioned, content?: TileBorderContent) {
		const coord = toAxialCoord(ref)
		if (!coord || isTileCoord(coord)) return
		if (!content) this.contents.delete({ q: coord.q, r: coord.r })
		else this.contents.set({ q: coord.q, r: coord.r }, content)
	}

	getRoadType(ref: Positioned): RoadType | undefined {
		const coord = toAxialCoord(ref)
		if (!coord || isTileCoord(coord)) return undefined
		return this.roadTypes.get(coord)
	}

	/** Set or clear the road type on a border coordinate. Roads intentionally coexist with border content. */
	setRoadType(ref: Positioned, type?: RoadType) {
		const coord = toAxialCoord(ref)
		if (!coord || isTileCoord(coord)) return
		const oldType = this.roadTypes.get(coord)
		if (oldType === type) return
		const border = this.getBorder(coord)
		if (type && border && !canBuildRoadAcrossBorder(border)) return
		if (!type) this.roadTypes.delete(coord)
		else this.roadTypes.set(coord, type)
		this.game.notifyRoadsChanged(
			[border?.tile.a.position, border?.tile.b.position]
				.map((position) => (position ? toAxialCoord(position) : undefined))
				.filter((position): position is AxialCoord => !!position)
		)
	}

	roadSegments(): RoadSegment[] {
		return Array.from(this.roadTypes.entries()).map(([key, type]) => ({
			coord: axial.coord(key),
			type,
		}))
	}

	private roadEffectAvailable(fromTile: AxialCoord, toTile: AxialCoord): boolean {
		const from = this.getTile(fromTile)
		const to = this.getTile(toTile)
		if (from?.isBurdened || to?.isBurdened) return false
		return true
	}

	/** Apply border-road movement bonuses only when moving between adjacent tile centers. */
	walkTimeBetween(from: Positioned, to: Positioned, baseWalkTime: number): number {
		if (!Number.isFinite(baseWalkTime)) return baseWalkTime
		const fromCoord = toAxialCoord(from)
		const toCoord = toAxialCoord(to)
		if (!fromCoord || !toCoord) return baseWalkTime
		const fromTile = axial.round(fromCoord)
		const toTile = axial.round(toCoord)
		if (axial.distance(fromTile, toTile) !== 1) {
			return baseWalkTime
		}
		const borderCoord = axial.linear([0.5, fromTile], [0.5, toTile])
		const roadType = this.getRoadType(borderCoord)
		const multiplier =
			roadType && this.roadEffectAvailable(fromTile, toTile)
				? ROAD_WALK_TIME_MULTIPLIERS[roadType]
				: 1
		return baseWalkTime * multiplier
	}

	reset(): void {
		this.game.withObjectRegistrationBatch(() => {
			for (const content of this.contents.values()) content.destroy()
			this.contents.clear()
			for (const tile of this.tileCache.values()) tile.destroy()
			for (const border of this.borderCache.values()) border.destroy()
			this.tileCache.clear()
			this.borderCache.clear()
			this.roadTypes.clear()
			this.occupied.clear()
			this.looseGoods.goods.clear()
			this.zoneManager.clear()
		})
	}

	getBorder(ref: Positioned): TileBorder | undefined {
		const coord = toAxialCoord(ref)
		if (!coord || isTileCoord(coord)) return undefined
		if (!this.inBound(coord)) return undefined
		const content = this.contents.get({ q: coord.q, r: coord.r }) as TileBorderContent | undefined
		if (content?.border) {
			this.borderCache.set(coord, content.border)
			return content.border
		}
		const cached = this.borderCache.get(coord)
		if (cached) return cached
		const border = this.game.withObjectRegistrationBatch(() => new TileBorder(this, coord))
		this.borderCache.set(coord, border)
		return border
	}

	/**
	 * Recursively traces the origin of a queue to detect circular dependencies
	 * @param character The character to trace
	 * @param visited Array of characters already visited in this trace
	 * @returns Array of characters forming a circular queue, or null if no circle found
	 */
	private traceQueueOrigin(character: Character, visited: Character[] = []): Character[] | null {
		// If we've already seen this character, we found a circle
		if (visited.includes(character)) {
			// Find the start of the circle by finding where this character appears
			const circleStart = visited.indexOf(character)
			return visited.slice(circleStart)
		}

		// Add current character to visited set
		visited.push(character)

		// Check if this character is queuing
		if (character.stepExecutor instanceof QueueStep) {
			const queueStep = character.stepExecutor
			const target = queueStep.target

			// Find who is currently occupying the target position
			const targetCoord = toAxialCoord(target)
			if (!targetCoord) return null
			const occupied = this.occupied.get(targetCoord!)
			if (occupied && occupied.length > 0) {
				const occupant = occupied[0]
				// If the occupant is also queuing and trying to move somewhere, trace them
				if (occupant.stepExecutor instanceof QueueStep) {
					return this.traceQueueOrigin(occupant, visited)
				}
			}
		}

		// No circle found
		return null
	}

	/**
	 * Releases all characters in a circular queue by clearing their stepExecutors
	 * @param circularQueue Array of characters forming a circular queue
	 */
	private releaseCircularQueue(circularQueue: Character[]): void {
		for (const character of circularQueue) {
			if (character.stepExecutor instanceof QueueStep) {
				character.stepExecutor.pass()
				character.stepExecutor = undefined
			}
		}
	}

	private removeCharacterFromOccupation(
		character: Character,
		preferredCoord?: AxialCoord
	): AxialCoord | undefined {
		const candidates = preferredCoord
			? [
					preferredCoord,
					...Array.from(this.occupied.coords()).filter(
						(coord) => axial.key(coord) !== axial.key(preferredCoord)
					),
				]
			: Array.from(this.occupied.coords())

		for (const coord of candidates) {
			const occupation = this.occupied.get(coord)
			if (!occupation?.length) continue
			const index = occupation.indexOf(character)
			if (index < 0) continue
			occupation.splice(index, 1)
			if (index === 0 && occupation[0]?.stepExecutor instanceof QueueStep) {
				occupation[0].stepExecutor.pass()
			}
			if (!occupation.length) this.occupied.delete(coord)
			return coord
		}

		if (preferredCoord) {
			throw new Error('Character has no tracked board occupation at the expected from coordinate')
		}
		return undefined
	}

	/** Attempts to move a character onto a coordinate. Returns true if successful. */
	moveCharacter(
		character: Character,
		to: Positioned,
		from?: Positioned
	): QueueStep<Character> | undefined {
		const fromCoord = from ? toAxialCoord(from) : undefined
		const toCoord = toAxialCoord(to)
		if (!toCoord) return undefined
		const occupied = this.occupied.get(toCoord!)! /*
		console.trace(character, toCoord.q, toCoord.r)
		if (occupied[0] === character) debugger*/
		if (occupied.includes(character)) return undefined
		if (fromCoord) this.removeCharacterFromOccupation(character, fromCoord)
		if (!occupied.length) {
			occupied.push(character)
			return undefined
		} else {
			// If the character is already the current occupant, we're good (e.g. restoration or idempotent move)
			if (occupied[0] === character) return undefined
			// Before creating a new queue, check for circular dependencies
			const circularQueue = this.traceQueueOrigin(character)
			if (circularQueue) {
				// Release the circular queue instead of adding to it
				this.releaseCircularQueue(circularQueue)
				occupied.push(character)
				return undefined
			}

			return new QueueStep(character, occupied, toCoord!)
		}
	}

	getNeighbors(coord: Positioned): NeighborInfo[] {
		const tile = this.getTile(coord)
		if (!tile) return []
		return this.getWalkNeighborsFromTile(tile)
	}

	getNeighborsForCharacter(coord: Positioned, _character: Character): NeighborInfo[] {
		const tile = this.getTile(coord)
		if (!tile) return []
		return this.getPedestrianTransitNeighborsFromTile(tile)
	}

	getNeighborsForVehicle(coord: Positioned): NeighborInfo[] {
		const tile = this.getTile(coord)
		if (!tile) return []
		return this.getVehicleTransitNeighborsFromTile(tile)
	}

	private getWalkNeighborsFromTile(fromTile: Tile): NeighborInfo[] {
		const fromCoord = toAxialCoord(fromTile.position)
		if (!fromCoord) return []
		return fromTile.walkNeighbors.map((neighbor) => ({
			coord: neighbor.coord,
			walkTime: this.walkTimeBetween(fromCoord, neighbor.coord, neighbor.walkTime),
		}))
	}

	private getPedestrianTransitNeighborsFromTile(
		fromTile: Tile,
		goalCoord?: AxialCoord
	): NeighborInfo[] {
		return this.getWalkNeighborsFromTile(fromTile).map((neighbor) => {
			if (goalCoord && axial.key(neighbor.coord) === axial.key(goalCoord)) {
				return neighbor
			}
			const neighborTile = this.getTile(neighbor.coord)
			if (neighborTile?.isBlockingSpace) {
				return { ...neighbor, walkTime: Number.POSITIVE_INFINITY }
			}
			return neighbor
		})
	}

	private getVehicleTransitNeighborsFromTile(fromTile: Tile): NeighborInfo[] {
		return this.getWalkNeighborsFromTile(fromTile).map((neighbor) => {
			const neighborTile = this.getTile(neighbor.coord)
			if (neighborTile?.isBlockingSpace) {
				return { ...neighbor, walkTime: Number.POSITIVE_INFINITY }
			}
			return neighbor
		})
	}

	private getPedestrianSearchNeighborsFromTile(
		fromTile: Tile,
		startCoord: AxialCoord,
		isEndpointAllowed: (coord: AxialCoord) => boolean
	): NeighborInfo[] {
		const fromCoord = toAxialCoord(fromTile.position)
		if (
			fromCoord &&
			axial.key(fromCoord) !== axial.key(startCoord) &&
			fromTile.isBlockingSpace
		) {
			return []
		}
		return this.getWalkNeighborsFromTile(fromTile).map((neighbor) => {
			const neighborTile = this.getTile(neighbor.coord)
			if (neighborTile?.isBlockingSpace && !isEndpointAllowed(neighbor.coord)) {
				return { ...neighbor, walkTime: Number.POSITIVE_INFINITY }
			}
			return neighbor
		})
	}

	findPathForCharacter(
		start: Positioned,
		goal: Positioned,
		character: Character,
		maxTime: number,
		punctual: boolean = true
	) {
		const goalCoord = toAxialCoord(goal)
		return findPath(
			(c) => {
				const tile = this.getTile(c)
				if (!tile) return []
				return this.getPedestrianTransitNeighborsFromTile(tile, goalCoord)
			},
			start,
			goal,
			maxTime,
			punctual
		)
	}

	findPath(start: Positioned, goal: Positioned, maxTime: number, punctual: boolean = true) {
		const goalCoord = toAxialCoord(goal)
		return findPath(
			(c) => {
				const tile = this.getTile(c)
				if (!tile) return []
				return this.getPedestrianTransitNeighborsFromTile(tile, goalCoord)
			},
			start,
			goal,
			maxTime,
			punctual
		)
	}

	findPathForVehicle(
		start: Positioned,
		goal: Positioned,
		maxTime: number,
		punctual: boolean = true
	) {
		const goalTile = this.getTile(goal)
		if (goalTile?.isBlockingSpace) return undefined
		return findPath((c) => this.getNeighborsForVehicle(c), start, goal, maxTime, punctual)
	}

	findPathForVehicleServiceBorder(start: Positioned, target: Positioned, maxTime: number) {
		const targetTile = this.getTile(target)
		if (!targetTile) return undefined
		if (!targetTile.isBlockingSpace) {
			return this.findPathForVehicle(start, targetTile.position, maxTime, true)
		}
		const startCoord = axial.round(toAxialCoord(start))
		let best: { path: AxialCoord[]; cost: number } | undefined
		for (const neighbor of targetTile.neighborTiles) {
			if (neighbor.isBlockingSpace) continue
			const neighborCoord = axial.round(toAxialCoord(neighbor.position))
			const path =
				axial.key(startCoord) === axial.key(neighborCoord)
					? [neighborCoord]
					: this.findPathForVehicle(startCoord, neighborCoord, maxTime, true)
			if (!path) continue
			const cost = path.length
			if (!best || cost < best.cost) best = { path, cost }
		}
		return best?.path
	}

	reachableForCharacter(start: Positioned, character: Character, maxTime: number) {
		return findReachable(
			(c) => this.getNeighborsForCharacter(c, character),
			axial.round(toAxialCoord(start)),
			maxTime
		)
	}

	reachableForVehicle(start: Positioned, maxTime: number) {
		return findReachable(
			(c) => this.getNeighborsForVehicle(c),
			axial.round(toAxialCoord(start)),
			maxTime
		)
	}

	findNearest(
		start: Positioned,
		isGoal: Scoring<true>,
		stop: number | ((coord: Positioned, walkTime: number) => boolean),
		punctual: boolean = true
	) {
		const startCoord = axial.round(toAxialCoord(start))
		return findNearest(
			(c) => {
				const tile = this.getTile(c)
				if (!tile) return []
				return this.getPedestrianSearchNeighborsFromTile(tile, startCoord, (coord) =>
					Boolean(isGoal(coord))
				)
			},
			start,
			isGoal,
			stop,
			punctual
		)
	}

	findNearestForCharacter(
		start: Positioned,
		character: Character,
		isGoal: Scoring<true>,
		stop: number | ((coord: Positioned, walkTime: number) => boolean),
		punctual: boolean = true
	) {
		const startCoord = axial.round(toAxialCoord(start))
		return findNearest(
			(c) => {
				const tile = this.getTile(c)
				if (!tile) return []
				return this.getPedestrianSearchNeighborsFromTile(tile, startCoord, (coord) =>
					Boolean(isGoal(coord))
				)
			},
			start,
			isGoal,
			stop,
			punctual
		)
	}

	findBestForCharacter(
		start: Positioned,
		character: Character,
		scoring: Scoring<number>,
		stop: number | ((coord: Positioned, walkTime: number) => boolean),
		bestPossibleScore: number,
		punctual: boolean = true
	) {
		const startCoord = axial.round(toAxialCoord(start))
		return findBest(
			(c) => {
				const tile = this.getTile(c)
				if (!tile) return []
				return this.getPedestrianSearchNeighborsFromTile(
					tile,
					startCoord,
					(coord) => scoring(coord) !== false
				)
			},
			start,
			scoring,
			stop,
			bestPossibleScore,
			punctual
		)
	}
}
