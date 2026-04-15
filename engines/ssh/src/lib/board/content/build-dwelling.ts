import { reactive } from 'mutts'
import type { Tile } from 'ssh/board/tile'
import { installBuildSitePrototype, registerConstructionMaterialPhaseEffect } from 'ssh/build-site'
import {
	type ConstructionSiteState,
	createConstructionSiteState,
	type DwellingTier,
} from 'ssh/construction-state'
import { buildAlveolusMarker } from 'ssh/hive/build-marker'
import { SpecificStorage } from 'ssh/storage/specific-storage'
import type { GoodType } from 'ssh/types/base'
import type { ExchangePriority, GoodsRelations } from 'ssh/utils/advertisement'
import { toAxialCoord } from 'ssh/utils/position'
import { TileContent } from './content'

@reactive
export class BuildDwelling extends TileContent {
	public readonly constructionSite: ConstructionSiteState
	public readonly targetTier: DwellingTier
	public readonly storage: SpecificStorage
	/**
	 * Seconds of work already applied toward the dwelling construction recipe.
	 * Increments when a construction work step completes or is canceled mid-way (partial credit).
	 */
	public constructionWorkSecondsApplied = 0
	public working = true
	public destroyed = false
	public declare canTake: (goodType: GoodType, priority: ExchangePriority) => boolean
	public declare canGive: (goodType: GoodType, priority: ExchangePriority) => boolean
	public declare readonly requiredGoods: Record<GoodType, number>
	public declare readonly remainingNeeds: Record<string, number>
	public declare readonly advertisedNeeds: Record<string, number>
	public declare readonly isReady: boolean
	public declare readonly workingGoodsRelations: GoodsRelations
	public declare readonly goodsRelations: GoodsRelations

	constructor(
		public readonly tile: Tile,
		tier: DwellingTier,
		constructionSite?: ConstructionSiteState
	) {
		const coord = toAxialCoord(tile.position)!
		super(tile.board.game, `build-dwelling:${coord.q},${coord.r}`)
		this.targetTier = tier
		this.constructionSite =
			constructionSite ?? createConstructionSiteState({ kind: 'dwelling', tier })
		this.storage = new SpecificStorage(
			this.constructionSite.recipe.goods as Record<GoodType, number>
		)
		if (['planned', 'foundation'].includes(this.constructionSite.phase)) {
			this.constructionSite.phase = 'waiting_materials'
		}
		registerConstructionMaterialPhaseEffect(`build-dwelling:${this.uid}`, this)
	}

	override get name(): string {
		return `build.dwelling.${this.targetTier}`
	}

	get debugInfo() {
		return {
			type: 'BuildDwelling',
			targetTier: this.targetTier,
		}
	}

	get walkTime(): number {
		return 1
	}

	get background(): string {
		return 'terrain.concrete'
	}

	/**
	 * Once the shell exists, it should read like a residential construction site, not like the
	 * pre-foundation project marker. Keep the normal zone tint/border until finalization provides
	 * the visible cabin sprite on `BasicDwelling`.
	 */
	override colorCode(): { tint: number; borderColor?: number } {
		return super.colorCode()
	}

	canInteract(_action: string): boolean {
		return false
	}
}

installBuildSitePrototype(BuildDwelling.prototype, { aliasGoodsRelations: true })

Object.defineProperty(BuildDwelling.prototype, buildAlveolusMarker, {
	value: true,
	configurable: false,
	enumerable: false,
	writable: false,
})
