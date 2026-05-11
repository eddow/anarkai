import { alveoli as alveoliDefs } from 'engine-rules'
import { reactive } from 'mutts'
import { Alveolus } from 'ssh/board/content/alveolus'
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
} from 'ssh/construction-state'
import { SpecificStorage } from 'ssh/storage/specific-storage'
import type { AlveolusType, GoodType } from 'ssh/types/base'
import { buildAlveolusMarker } from './build-marker'

@reactive
export class BuildAlveolus extends Alveolus {
	public readonly target: AlveolusType
	public readonly constructionSite: ConstructionSiteState

	/**
	 * Seconds of work already applied toward {@link alveoli}[target].construction.time.
	 * Increments when a construction work step completes or is canceled mid-way (partial credit).
	 */
	public constructionWorkSecondsApplied = 0

	constructor(tile: Tile, target: AlveolusType, constructionSite?: ConstructionSiteState) {
		const definition = alveoliDefs[target]
		super(
			tile,
			new SpecificStorage((definition.construction?.goods || {}) as Record<GoodType, number>)
		)

		this.assignGameContent(definition, target)

		// Store properties
		this.target = target
		this.constructionSite = normalizeConstructionSiteState(
			constructionSite ?? createConstructionSiteState({ kind: 'alveolus', alveolusType: target })
		)
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

export interface BuildAlveolus
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

installBuildSitePrototype(BuildAlveolus.prototype, { aliasGoodsRelations: true })

Object.defineProperty(BuildAlveolus.prototype, buildAlveolusMarker, {
	value: true,
	configurable: false,
	enumerable: false,
	writable: false,
})
