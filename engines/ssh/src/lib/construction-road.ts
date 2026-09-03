import { construction } from 'engine-rules'
import { reactive } from 'mutts'
import { TileContent } from 'ssh/board/content/content'
import { type Deposit, type PlantedTreesState, UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { type RoadType, roadBorderAnchorCoord } from 'ssh/board/roads'
import type { Tile } from 'ssh/board/tile'
import {
	type ConstructionSiteShell,
	installBuildSitePrototype,
	registerConstructionMaterialPhaseEffect,
} from 'ssh/build-site'
import {
	type ConstructionSiteState,
	createConstructionSiteState,
	normalizeConstructionSiteState,
	setConstructionConsumedGoods,
} from 'ssh/construction-state'
import { debugObjectId } from 'ssh/dev/debug-object-id'
import type { Project } from 'ssh/project'
import { SpecificStorage } from 'ssh/storage/specific-storage'
import type { TerrainType } from 'ssh/types'
import type { GoodType } from 'ssh/types/base'
import { axial, tileSize } from 'ssh/utils'
import { toWorldCoord } from 'ssh/utils/position'

/**
 * Road construction helpers. A road is built/demolished **one border at a time**,
 * anchored to a single deterministic endpoint tile (see {@link roadBorderAnchorCoord}):
 *
 * - **Building**: a {@link RoadConstructionSite} (a full construction site, like any
 *   building) is placed on the anchor tile. It advertises the segment's material demand
 *   through the normal construction-demand path and receives goods into its own storage.
 *   Once materials are complete, a road engineer works and places the segment.
 * - **Demolition**: the road engineer stands on the same anchor tile, works, removes the
 *   segment, and ~50% of its construction goods are refunded as loose goods on that tile.
 *
 * The anchor tile is the *same* for both directions, so build-side and refund-side never split.
 */

export interface RoadBuildRecipe {
	goods: Partial<Record<GoodType, number>>
	time: number
}

/** Construction recipe (goods + work time) for one road segment. */
export function roadBuildRecipe(roadType: RoadType): RoadBuildRecipe {
	const recipe = construction.road[roadType]
	return { goods: { ...recipe.goods }, time: recipe.time }
}

/** The canonical anchor tile for a road border, or `undefined` when it is off-board. */
export function roadAnchorTile(
	game: { hex: { getTile(ref: { q: number; r: number }): Tile | undefined } },
	coord: readonly [number, number]
): Tile | undefined {
	const anchor = roadBorderAnchorCoord(coord)
	return game.hex.getTile({ q: anchor[0], r: anchor[1] })
}

/** ~50% refund of a road segment's construction materials (per-unit coin flip). */
export function roadRefundGoods(
	roadType: RoadType,
	random: () => number
): Partial<Record<GoodType, number>> {
	const { goods } = roadBuildRecipe(roadType)
	const refund: Partial<Record<GoodType, number>> = {}
	for (const [good, qty] of Object.entries(goods)) {
		let amount = 0
		for (let i = 0; i < (qty ?? 0); i++) {
			if (random() < construction.demolition.refundFraction) amount++
		}
		if (amount > 0) refund[good as GoodType] = amount
	}
	return refund
}

/** Spawn loose goods on a tile (demolition refunds here; build uses its own storage). */
export function spawnRoadLooseGoods(tile: Tile, goods: Partial<Record<GoodType, number>>): void {
	const { x: tileX, y: tileY } = toWorldCoord(tile.position)!
	for (const [goodType, quantity] of Object.entries(goods)) {
		for (let i = 0; i < (quantity ?? 0); i++) {
			const { x, y } = axial.randomPositionInTile(tile.board.game.random, tileSize)
			tile.board.looseGoods.add(tile.position, goodType as GoodType, {
				position: { x: tileX + x, y: tileY + y },
			})
		}
	}
}

/** Place a road segment on the board. */
export function buildRoadSegment(
	game: { hex: { setRoadType(ref: { q: number; r: number }, type?: RoadType): void } },
	coord: readonly [number, number],
	type: RoadType
): void {
	game.hex.setRoadType({ q: coord[0], r: coord[1] }, type)
}

/**
 * A road segment's construction site, placed on the border's anchor tile. It behaves
 * exactly like a building construction shell: it advertises material demand (via
 * {@link installBuildSitePrototype}), receives goods into its own storage, and, once
 * ready, a road engineer works and {@link finalize}s it — placing the segment and
 * restoring the original tile content.
 */
@reactive
export class RoadConstructionSite extends TileContent {
	public readonly tile: Tile
	public readonly coord: readonly [number, number]
	public readonly roadType: RoadType
	public readonly constructionSite: ConstructionSiteState
	public readonly storage: SpecificStorage
	public constructionWorkSecondsApplied = 0
	public working = true
	public destroyed = false
	public project?: Project

	private readonly originalTerrain: TerrainType
	private readonly originalDeposit?: Deposit
	private readonly originalPlantedTrees?: PlantedTreesState

	constructor(tile: Tile, coord: readonly [number, number], roadType: RoadType, project: Project) {
		super(tile.board.game, `road-site:${roadType}:${coord[0]},${coord[1]}`)
		this.tile = tile
		this.coord = coord
		this.roadType = roadType
		this.project = project

		// Preserve the replaced content so it can be restored on finalize.
		const original = tile.content
		if (original instanceof UnBuiltLand) {
			this.originalTerrain = original.terrain
			this.originalDeposit = original.deposit
			this.originalPlantedTrees = original.plantedTrees
		} else {
			this.originalTerrain = tile.terrainState?.terrain ?? tile.baseTerrain ?? 'grass'
		}

		this.constructionSite = normalizeConstructionSiteState(
			createConstructionSiteState({ kind: 'road', roadType })
		)
		if (['planned', 'foundation'].includes(this.constructionSite.phase)) {
			this.constructionSite.phase = 'waiting_materials'
		}
		this.storage = new SpecificStorage(
			this.constructionSite.requiredGoods as Record<GoodType, number>
		)
		this.storage.setPresentationChangeNotifier(() =>
			this.game.enqueueStoragePresentationChange?.(this.tile)
		)
		registerConstructionMaterialPhaseEffect(`road-site:${debugObjectId(this)}`, this)
	}

	override get name(): string {
		return `road-site.${this.roadType}`
	}

	override get debugInfo(): Record<string, unknown> {
		return {
			type: 'RoadConstructionSite',
			roadType: this.roadType,
			coord: this.coord,
			isReady: this.isReady,
		}
	}

	get walkTime(): number {
		return 1
	}

	get background(): string {
		return `terrain.${this.originalTerrain}`
	}

	override colorCode(): { tint: number; borderColor?: number } {
		// Read like an in-progress construction site, not empty land.
		return { tint: 0xffb4d9, borderColor: 0xff1493 }
	}

	canInteract(_action: string): boolean {
		return false
	}

	/** Place the segment, consume its materials, restore the tile, and re-materialize pending roads. */
	finalize(): void {
		buildRoadSegment(this.tile.board.game, this.coord, this.roadType)
		setConstructionConsumedGoods(this.constructionSite, this.requiredGoods)
		this.tile.board.game.hex.setTileContent(
			this.tile,
			new UnBuiltLand(
				this.tile,
				this.originalTerrain,
				this.originalDeposit,
				this.originalPlantedTrees
			)
		)
		this.tile.board.game.invalidateWorkPlanning('road-site.finalize')
		// Freeing the anchor tile may let another deferred road site materialize here.
		;(
			this.tile.board.game as { materializePendingRoadSites?(): void }
		).materializePendingRoadSites?.()
	}
}

export interface RoadConstructionSite
	extends Pick<
		ConstructionSiteShell,
		| 'advertisedNeeds'
		| 'canGive'
		| 'canTake'
		| 'isReady'
		| 'remainingNeeds'
		| 'requiredGoods'
		| 'workingGoodsRelations'
	> {}

installBuildSitePrototype(RoadConstructionSite.prototype, { aliasGoodsRelations: true })
