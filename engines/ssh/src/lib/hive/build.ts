import { alveoli as alveoliDefs } from 'engine-rules'
import { reactive } from 'mutts'
import { TileContent } from 'ssh/board/content/content'
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
import { toAxialCoord } from 'ssh/utils/position'
import { buildAlveolusMarker } from './build-marker'

@reactive
export class BuildAlveolus extends TileContent {
	public readonly target: AlveolusType
	public readonly constructionSite: ConstructionSiteState
	public readonly storage: SpecificStorage
	public readonly tile: Tile

	/**
	 * Seconds of work already applied toward {@link alveoli}[target].construction.time.
	 * Increments when a construction work step completes or is canceled mid-way (partial credit).
	 */
	public constructionWorkSecondsApplied = 0
	public working = true
	public destroyed = false
	public assignedWorker: unknown

	constructor(tile: Tile, target: AlveolusType, constructionSite?: ConstructionSiteState) {
		const definition = alveoliDefs[target]
		const coord = toAxialCoord(tile.position)!
		super(tile.board.game, `build-alveolus:${target}:${coord.q},${coord.r}`)
		this.tile = tile
		this.storage = new SpecificStorage(
			(definition.construction?.goods || {}) as Record<GoodType, number>
		)
		this.storage.setPresentationChangeNotifier(() =>
			this.game.enqueueStoragePresentationChange?.(this.tile)
		)

		this.target = target
		this.constructionSite = normalizeConstructionSiteState(
			constructionSite ?? createConstructionSiteState({ kind: 'alveolus', alveolusType: target })
		)
		if (['planned', 'foundation'].includes(this.constructionSite.phase)) {
			this.constructionSite.phase = 'waiting_materials'
		}
		registerConstructionMaterialPhaseEffect(`build-alveolus:${this.uid}`, this)
	}

	override get name(): string {
		return `build.${this.target}`
	}

	override get titleKey(): string {
		return `alveoli.${this.target}`
	}

	get debugInfo(): Record<string, unknown> {
		return {
			type: 'BuildAlveolus',
			target: this.target,
		}
	}

	get walkTime(): number {
		return 1
	}

	get background(): string {
		return 'terrain.concrete'
	}

	canInteract(_action: string): boolean {
		return false
	}

	get proposedJobs(): readonly [] {
		return []
	}

	getJob(): undefined {
		return undefined
	}

	get aGoodMovement(): undefined {
		return undefined
	}

	get incomingGoods(): boolean {
		return false
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
