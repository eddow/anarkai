import { reactive } from 'mutts'
import { assert } from 'ssh/src/lib/debug'
import type { Game } from 'ssh/src/lib/game'
import { GameObject, withContainer, withHittable } from 'ssh/src/lib/game/object'
import { QueueStep } from 'ssh/src/lib/npcs'
import type { Character } from 'ssh/src/lib/population'
import {
	type AxialCoord,
	axial,
	findBest,
	findNearest,
	findPath,
	fromCartesian,
	isInteger,
	type NeighborInfo,
	type Positioned,
	type Scoring,
	tileSize,
	toAxialCoord,
} from 'ssh/src/lib/utils'
import { AxialKeyMap } from 'ssh/src/lib/utils/mem'
import { TileBorder, type TileBorderContent } from './border/border'
import type { TileContent } from './content/content'
import { FreeGoods } from './freeGoods'
import { Tile } from './tile'
import { ZoneManager } from './zone'

export function isTileCoord(coord: AxialCoord | undefined): boolean {
	return !!coord && isInteger(coord.q) && isInteger(coord.r)
}

@reactive
export class HexBoard extends withContainer(withHittable(GameObject)) {
	private readonly contents = new AxialKeyMap<TileContent | TileBorderContent>()
	private readonly occupied = new AxialKeyMap<Character[]>([], () => [])
	// Will contain goods when perhaps destroying a building (war-like destruction), killing a character,
	// stopping (or making) a transit, etc.
	readonly freeGoods: FreeGoods
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

	constructor(
		public game: Game,
		public readonly boardSize: number = 12,
	) {
		super(game)
		this.freeGoods = new FreeGoods(game)
		this.zoneManager = new ZoneManager()
		this.zIndex = -1
	}

	hitTest(worldX: number, worldY: number, selectedAction?: string): any {
		const coord = axial.round(fromCartesian({ x: worldX, y: worldY }, tileSize))
		if (axial.distance(coord, { q: 0, r: 0 }) > this.boardSize) return false
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
		return axial.distance(ax) < this.boardSize
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
		if (oldContent) oldContent.destroy()
		if (!content) this.contents.delete({ q: coord.q, r: coord.r })
		else this.contents.set({ q: coord.q, r: coord.r }, content)
		// If a tile content is set programmatically post-generation, mark tile dirty
		const tile = content?.tile ?? (coord ? this.getTile(coord) : undefined)
		if (tile) tile.asGenerated = false
	}

	getTile(ref: Positioned): Tile | undefined {
		const coord = toAxialCoord(ref)
		if (!coord || !isTileCoord(coord) || !this.inBound(coord)) return undefined
		const content = this.contents.get(axial.round(coord)) as TileContent | undefined
		return content?.tile ?? new Tile(this, coord!)
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

	getBorder(ref: Positioned): TileBorder | undefined {
		const coord = toAxialCoord(ref)
		if (!coord || isTileCoord(coord)) return undefined
		if (!this.inBound(coord)) return undefined
		const content = this.contents.get({ q: coord.q, r: coord.r }) as TileBorderContent | undefined
		return content?.border ?? new TileBorder(this, coord!)
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

	/** Attempts to move a character onto a coordinate. Returns true if successful. */
	moveCharacter(
		character: Character,
		to: Positioned,
		from?: Positioned,
	): QueueStep<Character> | undefined {
		if (from) {
			const fromCoord = toAxialCoord(from)
			if (fromCoord) {
				const occupation = this.occupied.get(fromCoord!)!
				const occupant = occupation.shift()
				assert(occupant === character, 'Character is not the occupant of the from coordinate')
				if (occupation[0]) {
					assert(occupation[0].stepExecutor instanceof QueueStep, 'Occupant is queuing')
					occupation[0].stepExecutor.pass()
				} else {
					this.occupied.delete(fromCoord!)
				}
			}
		}
		const toCoord = toAxialCoord(to)
		if (!toCoord) return undefined
		const occupied = this.occupied.get(toCoord!)! /*
		console.trace(character, toCoord.q, toCoord.r)
		if (occupied[0] === character) debugger*/
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
		return tile.walkNeighbors
	}

	getNeighborsForCharacter(coord: Positioned, _character: Character): NeighborInfo[] {
		const tile = this.getTile(coord)
		if (!tile) return []
		return tile.walkNeighbors
	}

	findPathForCharacter(
		start: Positioned,
		goal: Positioned,
		character: Character,
		maxTime: number,
		punctual: boolean = true,
	) {
		return findPath(
			(c) => this.getNeighborsForCharacter(c, character),
			start,
			goal,
			maxTime,
			punctual,
		)
	}

	findPath(start: Positioned, goal: Positioned, maxTime: number, punctual: boolean = true) {
		return findPath((c) => this.getNeighbors(c), start, goal, maxTime, punctual)
	}

	findNearest(
		start: Positioned,
		isGoal: Scoring<true>,
		stop: number | ((coord: Positioned, walkTime: number) => boolean),
		punctual: boolean = true,
	) {
		return findNearest((c) => this.getNeighbors(c), start, isGoal, stop, punctual)
	}

	findNearestForCharacter(
		start: Positioned,
		character: Character,
		isGoal: Scoring<true>,
		stop: number | ((coord: Positioned, walkTime: number) => boolean),
		punctual: boolean = true,
	) {
		return findNearest(
			(c) => this.getNeighborsForCharacter(c, character),
			start,
			isGoal,
			stop,
			punctual,
		)
	}

	findBestForCharacter(
		start: Positioned,
		character: Character,
		scoring: Scoring<number>,
		stop: number | ((coord: Positioned, walkTime: number) => boolean),
		bestPossibleScore: number,
		punctual: boolean = true,
	) {
		return findBest(
			(c) => this.getNeighborsForCharacter(c, character),
			start,
			scoring,
			stop,
			bestPossibleScore,
			punctual,
		)
	}
}
