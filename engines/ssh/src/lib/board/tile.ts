import { inert, reactive } from 'mutts'
import { GameObject, withInteractive } from 'ssh/game/object'
import type { TerrainHydrologySample } from 'ssh/game/terrain-provider'
import { Hive } from 'ssh/hive/hive'
import { gameIsaTypes } from 'ssh/npcs/utils'
import type { Character } from 'ssh/population/character'
import { isVehicleLineService, isVehicleMaintenanceService } from 'ssh/population/vehicle/vehicle'
import { traceProjection } from 'ssh/trace'
import type { TerrainType } from 'ssh/types'
import type { AlveolusType, Job } from 'ssh/types/base'
import { type AxialCoord, axial, type NeighborInfo } from 'ssh/utils'
import { axialDistance, type Position, type Positioned, toAxialCoord } from 'ssh/utils/position'
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
	hydrology?: TerrainHydrologySample
}

const CHANNEL_WALK_TIME_MULTIPLIER = 2

@reactive // TODO: this might need to be unreactive
export class Tile extends withInteractive(GameObject) {
	// True when the tile is exactly as produced by generation
	public asGenerated: boolean = false
	// Raw terrain height from engine-terrain, optionally patched by terraforming.
	public terrainHeight?: number
	public baseTerrain?: TerrainType
	public terrainHydrology?: TerrainHydrologySample
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
			const neighboringHives = new Set<Hive>()
			for (const neighbor of this.neighborTiles) {
				const neighborContent = neighbor?.content
				if (!(neighborContent instanceof Alveolus)) continue
				neighboringHives.add(neighborContent.hive)
			}
			const hive = Array.from(neighboringHives)[0] ?? Hive.for(this)
			hive.attach(content)
			this.board.markHiveTopologyDirty(hive)
			for (const neighborHive of neighboringHives) this.board.markHiveTopologyDirty(neighborHive)
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
			content: this.content?.logInfo,
			zone: this.zone,
			hydrology: this.hydrology,
		}
	}

	get [traceProjection]() {
		return {
			$type: 'Tile',
			uid: this.uid,
			position: this.position,
			zone: this.zone,
		}
	}

	get hydrology(): TerrainHydrologySample | undefined {
		return this.terrainHydrology ?? this.terrainState?.hydrology
	}

	get riverWalkTimeMultiplier(): number {
		return this.hydrology?.isChannel ? CHANNEL_WALK_TIME_MULTIPLIER : 1
	}

	get effectiveWalkTime(): number {
		const baseWalkTime = this.content?.walkTime ?? Number.POSITIVE_INFINITY
		if (!Number.isFinite(baseWalkTime)) return baseWalkTime
		return baseWalkTime * this.riverWalkTimeMultiplier
	}

	// Tile-level job offering
	getJob(character?: Character): Job | undefined {
		return inert(() => {
			// Check if UnBuiltLand has a project-related job (clearing for construction)
			if (this.content instanceof UnBuiltLand) {
				const unbuiltJob = this.content.getJob()
				if (unbuiltJob) return unbuiltJob
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
		this.board.game.enqueueInteractiveChange(this)
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
	 * Narrower predicate than {@link isBurdened}: true when the tile carries no deposit and no
	 * loose goods. Vehicles are intentionally ignored — they can move out of the way, so the
	 * construction-phase effect (`unbuilt-land.ts:43-46`) treats them as transient. Use
	 * {@link isBurdened} when "is this hex blocked for parking / dumping" is the actual question.
	 */
	get isClear(): boolean {
		const coord = toAxialCoord(this.position)
		const content = this.board.getTileContent(coord)

		if (content && 'deposit' in content && content.deposit) {
			return false
		}

		const looseGoods = this.board.looseGoods.getGoodsAt(coord)
		if (looseGoods.length > 0) {
			return false
		}

		return true
	}

	/**
	 * True when the tile is "in the way" for parking, dumping, or starting a build phase: deposit
	 * or loose goods (per {@link isClear}) **or** an idle / non-docked line-freight vehicle sits on
	 * it. Docked vehicles do not burden — they advertise dock work via the bay; the
	 * dock-completion path (chunk B Phase 6) routes the empty wheelbarrow into a `parkVehicle` job.
	 */
	get isBurdened(): boolean {
		if (!this.isClear) return true
		const coord = toAxialCoord(this.position)
		const game = this.board.game
		for (const vehicle of game.vehicles) {
			const vp = toAxialCoord(vehicle.position)
			if (!vp) continue
			if (Math.round(vp.q) !== coord.q || Math.round(vp.r) !== coord.r) continue
			const svc = vehicle.service
			if (isVehicleLineService(svc) && svc.docked) continue
			if (isVehicleLineService(svc) || isVehicleMaintenanceService(svc) || svc === undefined) {
				return true
			}
		}
		return false
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
							walkTime: tile.effectiveWalkTime,
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
