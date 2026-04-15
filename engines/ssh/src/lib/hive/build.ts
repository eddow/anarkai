import { alveoli as alveoliDefs } from 'engine-rules'
import { reactive } from 'mutts'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import { installBuildSitePrototype, registerConstructionMaterialPhaseEffect } from 'ssh/build-site'
import { type ConstructionSiteState, createConstructionSiteState } from 'ssh/construction-state'
import { SpecificStorage } from 'ssh/storage/specific-storage'
import type { AlveolusType, GoodType } from 'ssh/types/base'
import type { ExchangePriority, GoodsRelations } from 'ssh/utils/advertisement'
import { buildAlveolusMarker } from './build-marker'

@reactive
export class BuildAlveolus extends Alveolus {
	public readonly target: AlveolusType
	public readonly constructionSite: ConstructionSiteState
	public declare readonly storage: SpecificStorage
	public declare canTake: (goodType: GoodType, priority: ExchangePriority) => boolean
	public declare canGive: (goodType: GoodType, priority: ExchangePriority) => boolean
	public declare readonly requiredGoods: Record<GoodType, number>
	public declare readonly remainingNeeds: Record<string, number>
	public declare readonly advertisedNeeds: Record<string, number>
	public declare readonly isReady: boolean
	public declare readonly workingGoodsRelations: GoodsRelations

	/**
	 * Seconds of work already applied toward {@link alveoli}[target].construction.time.
	 * Increments when a construction work step completes or is canceled mid-way (partial credit).
	 */
	public constructionWorkSecondsApplied = 0

	constructor(tile: Tile, target: AlveolusType, constructionSite?: ConstructionSiteState) {
		super(
			tile,
			new SpecificStorage(
				(alveoliDefs[target].construction?.goods || {}) as Record<GoodType, number>
			)
		)

		// Store properties
		this.target = target
		this.constructionSite =
			constructionSite ?? createConstructionSiteState({ kind: 'alveolus', alveolusType: target })
		if (['planned', 'foundation'].includes(this.constructionSite.phase)) {
			this.constructionSite.phase = 'waiting_materials'
		}
		registerConstructionMaterialPhaseEffect(`build-alveolus:${this.uid}`, this)

		// Override name property to provide build-specific naming
		Object.defineProperty(this, 'name', {
			value: `build.${this.target}`,
			writable: false,
			configurable: false,
			enumerable: true,
		})
	}
}

installBuildSitePrototype(BuildAlveolus.prototype)

Object.defineProperty(BuildAlveolus.prototype, buildAlveolusMarker, {
	value: true,
	configurable: false,
	enumerable: false,
	writable: false,
})
