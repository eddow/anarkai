import { inert, reactive } from 'mutts'
import { GameObject, withInteractive } from 'ssh/game/object'
import { Hive } from 'ssh/hive'
import { gameIsaTypes } from 'ssh/npcs/utils'
import type { Character } from 'ssh/population/character'
import type { TerrainType } from 'ssh/types'
import type { AlveolusType, Job } from 'ssh/types/base'
import { type AxialCoord, axial, type NeighborInfo } from 'ssh/utils'
import { axialDistance, type Position, type Positioned, toAxialCoord } from 'ssh/utils/position'
import { jobBalance } from '../../../assets/game-content'
import type { HexBoard } from './board'
import type { TileBorder } from './border/border'
import { Alveolus } from './content/alveolus'
import type { TileContent } from './content/content'
import { UnBuiltLand } from './content/unbuilt-land'
import type { LooseGood } from './looseGoods'
import type { Zone } from './zone'

export interface TileTerrainState {
	terrain?: TerrainType
	height?: number
	temperature?: number
	humidity?: number
	sediment?: number
	waterTable?: number
}

@reactive // TODO: this might need to be unreactive
export class Tile extends withInteractive(GameObject) {
	// True when the tile is exactly as produced by generation
	public asGenerated: boolean = false
	// Raw terrain height from engine-terrain, optionally patched by terraforming.
	public terrainHeight?: number
	public baseTerrain?: TerrainType
	public terrainState?: TileTerrainState

	get content(): TileContent | undefined {
		return this.board.getTileContent(toAxialCoord(this.position))
	}
	set content(content: TileContent) {
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
		coord: AxialCoord
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
		if (!this.position) return 'Tile (Initializing)'
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
		return inert(() => {
			// Check if UnBuiltLand has a project-related job (clearing for construction)
			if (this.content instanceof UnBuiltLand) {
				const unbuiltJob = this.content.getJob()
				if (unbuiltJob) return unbuiltJob
			}

			// Offload if there are loose goods on tile and it's a residential zone or alveolus tile
			// Note: harvest zones do NOT trigger offload (goods can be dropped there)
			// Cache the expensive computation during pathfinding
			const hasLooseGoods = this.availableGoods.length > 0
			if (hasLooseGoods && this.zone === 'residential') {
				const looseGood = this.availableGoods.find(
					(good) => !character || character.carry.hasRoom(good.goodType) > 0
				)
				if (!looseGood) return undefined
				return {
					job: 'offload',
					fatigue: 1,
					urgency: jobBalance.offload.residentialTile,
					looseGood,
				}
			}
			// Otherwise delegate to alveolus if present
			if (this.content instanceof Alveolus) return this.content.getJob(character)
		})
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

	get clearing(): boolean {
		return (
			![undefined, 'harvest'].includes(this.zone) ||
			(!!this.content &&
				(('project' in this.content && !!this.content.project) || this.content instanceof Alveolus))
		)
	}

	canInteract(action: string): boolean {
		return this.content?.canInteract?.(action) ?? false
	}

	/**
	 * Check if tile is clear of obstacles (no deposits, no loose goods)
	 */
	get isClear(): boolean {
		const coord = toAxialCoord(this.position)
		const content = this.board.getTileContent(coord)

		// Check content for deposit (only applicable to UnBuiltLand)
		if (content && 'deposit' in content && content.deposit) {
			return false
		}

		// Check if there are loose goods
		const looseGoods = this.board.looseGoods.getGoodsAt(coord)
		if (looseGoods.length > 0) {
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
			.map((n) => ({
				border: this.borderWith(n),
				tile: this.board.getTileContent(n),
			}))
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
	get neighborTiles(): Tile[] {
		return axial
			.neighbors(toAxialCoord(this.position))
			.map((neighbor) => this.board.getTile(neighbor))
			.filter((tile): tile is Tile => tile !== undefined)
	}

	// TODO: @memoize
	get walkNeighbors(): NeighborInfo[] {
		const coord = toAxialCoord(this.position)
		const neighbors = axial.neighbors(coord)
		return neighbors
			.map((neighbor: Positioned) => {
				const tile = this.board.getTile(neighbor)
				return tile?.content
					? {
							coord: toAxialCoord(neighbor),
							walkTime: tile.content.walkTime,
						}
					: null
			})
			.filter((neighbor): neighbor is NeighborInfo => neighbor !== null)
	}

	// REHABILITATED MEMOIZE
	get looseGoods(): LooseGood[] {
		return this.board.looseGoods.getGoodsAt(this.position)
	}

	// REHABILITATED MEMOIZE
	get availableGoods(): LooseGood[] {
		return this.looseGoods.filter((g) => g.available)
	}
}

gameIsaTypes.tile = (value: any) => {
	return value instanceof Tile
}
