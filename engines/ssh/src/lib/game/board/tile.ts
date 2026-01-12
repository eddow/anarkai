import { memoize, unreactive } from 'mutts'
import type { Character } from '$lib/game/population/character'
import type { AlveolusType, Job } from '$lib/types/base'
import { type AxialCoord, axial, type NeighborInfo } from '$lib/utils'
import { axialDistance, type Position, type Positioned, toAxialCoord } from '../../utils/position'
import { Hive } from '../hive'
import { gameIsaTypes } from '../npcs/utils'
import { GameObject, withInteractive } from '../object'
import type { HexBoard } from './board'
import type { TileBorder } from './border/border'
import { Alveolus } from './content/alveolus'
import type { TileContent } from './content/content'
import { UnBuiltLand } from './content/unbuilt-land'
import type { FreeGood } from './freeGoods'
import type { Zone } from './zone'

@unreactive
export class Tile extends withInteractive(GameObject) {
	// True when the tile is exactly as produced by generation
	public asGenerated: boolean = false
	//TODO: @memoize
	get content(): TileContent | undefined {
		return this.board.getTileContent(toAxialCoord(this.position))
	}
	set content(content: TileContent) {
		this.content?.destroy?.()
		this.board.setTileContent(toAxialCoord(this.position), content)
		// Mark as modified from generation when content changes
		this.asGenerated = false

		// If content is an Alveolus, handle hive attachment
		if (content instanceof Alveolus) {
			const hive = Hive.for(this)
			hive.attach(content)
		}
	}
	constructor(
		public readonly board: HexBoard,
		coord: AxialCoord,
	) {
		super(board.game, `tile:${coord.q},${coord.r}`)
		this.position = coord
		// Set tile reference on content
	}
	readonly position: Position
	get tile(): Tile {
		return this
	}

	get title(): string {
		const axial = toAxialCoord(this.position)
		return axial ? `Tile ${axial.q}, ${axial.r}` : 'Tile (Unknown)'
	}

	get debugInfo(): Record<string, any> {
		return {
			position: this.position,
			content: this.content?.debugInfo,
			zone: this.zone,
		}
	}

	// Tile-level job offering
	getJob(character?: Character): Job | undefined {
		// Check if UnBuiltLand has a project-related job (clearing for construction)
		if (this.content instanceof UnBuiltLand) {
			const unbuiltJob = this.content.getJob()
			if (unbuiltJob) return unbuiltJob
		}

		// Offload if there are free goods on tile and it's a residential zone or alveolus tile
		// Note: harvest zones do NOT trigger offload (goods can be dropped there)
		// Cache the expensive computation during pathfinding
		const hasFreeGoods = this.availableGoods.length > 0
		const isResidentialOrAlveolus = this.zone === 'residential' || this.content instanceof Alveolus
		if (hasFreeGoods && isResidentialOrAlveolus) {
			return { job: 'offload', fatigue: 1, urgency: 10 }
		}
		// Otherwise delegate to alveolus if present
		if (this.content instanceof Alveolus) return this.content.getJob(character)
	}

	// Zone getter/setter
	get zone(): Zone | undefined {
		return this.board.zoneManager.getZone(toAxialCoord(this.position))
	}

	set zone(zone: Zone | undefined) {
		if (zone === undefined) {
			this.board.zoneManager.removeZone(toAxialCoord(this.position))
		} else {
			this.board.zoneManager.setZone(toAxialCoord(this.position), zone)
		}
	}

	@memoize
	get clearing(): boolean {
		return (
			![undefined, 'harvest'].includes(this.zone) ||
			(!!this.content && ('project' in this.content || this.content instanceof Alveolus))
		)
	}

	canInteract(action: string): boolean {
		return this.content?.canInteract?.(action) ?? false
	}

	/**
	 * Check if tile is clear of obstacles (no deposits, no free goods)
	 */
	get isClear(): boolean {
		const coord = toAxialCoord(this.position)
		const content = this.board.getTileContent(coord)

		// Check content for deposit (only applicable to UnBuiltLand)
		if (content && 'deposit' in content && content.deposit) {
			return false
		}

		// Check if there are free goods
		const freeGoods = this.board.freeGoods.getGoodsAt(coord)
		if (freeGoods.length > 0) {
			return false
		}

		return true
	}

	build(alveolusType: AlveolusType): boolean {
		// Check if content can be built on
		if (!this.canInteract(`build:${alveolusType}`)) {
			return false
		}

		// Set project on UnBuiltLand instead of creating BuildAlveolus immediately
		// The tile must be cleared first, then BuildAlveolus will be created
		const content = this.content
		if (content instanceof UnBuiltLand) {
			content.setProject(`build:${alveolusType}`)
		}
		return true
	}

	get surroundings(): { border: TileBorder; tile: TileContent }[] {
		return axial
			.neighbors(toAxialCoord(this.position))
			.map((n) => ({ border: this.borderWith(n), tile: this.board.getTileContent(n) }))
			.filter((b) => b.border !== undefined && b.tile !== undefined) as {
			border: TileBorder
			tile: TileContent
		}[]
	}

	borderWith(positioned: Positioned): TileBorder | undefined {
		const thisCoord = toAxialCoord(this)
		const otherCoord = toAxialCoord(positioned)
		if (axialDistance(this, positioned) !== 1) return
		const coord = axial.linear([0.5, thisCoord], [0.5, otherCoord])
		return this.board.getBorder(coord)
	}
	@memoize
	get neighborTiles(): Tile[] {
		return axial
			.neighbors(toAxialCoord(this.position))
			.map((neighbor) => this.board.getTile(neighbor))
			.filter((tile): tile is Tile => tile !== undefined)
	}

	@memoize
	get walkNeighbors(): NeighborInfo[] {
		const coord = toAxialCoord(this.position)
		const neighbors = axial.neighbors(coord)
		return neighbors
			.map((neighbor: Positioned) => {
				const tile = this.board.getTile(neighbor)
				return tile
					? {
							coord: toAxialCoord(neighbor),
							walkTime: tile.content!.walkTime,
						}
					: null
			})
			.filter((neighbor): neighbor is NeighborInfo => neighbor !== null)
	}

	//@memoize
	get freeGoods(): FreeGood[] {
		return this.board.freeGoods.getGoodsAt(this.position)
	}

	//@memoize
	get availableGoods(): FreeGood[] {
		return this.freeGoods.filter((g) => g.available)
	}
}

gameIsaTypes.tile = (value: any) => {
	return value instanceof Tile
}
