import { reactive } from 'mutts'
import { TileContent } from 'ssh/board/content/content'
import type { Tile } from 'ssh/board/tile'
import {
	type ConstructionSiteShell,
	installBuildSitePrototype,
	registerConstructionMaterialPhaseEffect,
} from 'ssh/build-site'
import {
	type ConstructionRecipe,
	type ConstructionSiteState,
	createConstructionSiteState,
	normalizeConstructionSiteState,
	resolveAlveolusVariant,
} from 'ssh/construction-state'
import { SpecificStorage } from 'ssh/storage/specific-storage'
import type { AlveolusType, GoodType } from 'ssh/types/base'
import { toAxialCoord } from 'ssh/utils/position'
import { buildAlveolusMarker } from './build-marker'

@reactive
export class BuildAlveolus extends TileContent {
	public readonly target: AlveolusType
	public readonly variantId?: string
	/** Full variant target (e.g., "wood.extra" when building pile.wood.extra). */
	public readonly targetVariantId?: string
	public readonly constructionSite: ConstructionSiteState
	public readonly storage: SpecificStorage
	public readonly tile: Tile

	/**
	 * Seconds of work already applied toward the current step's recipe.
	 * Increments when a construction work step completes or is canceled mid-way (partial credit).
	 */
	public constructionWorkSecondsApplied = 0

	/** Remaining construction recipes after the current step completes. */
	public readonly constructionQueue: readonly ConstructionRecipe[]

	/** Zero-based index into ancestorChain for the currently-active step. */
	public readonly constructionStepIndex: number

	public working = true
	public destroyed = false
	public assignedWorker: unknown
	public hivePlanId?: string
	public hivePlanVersion?: number
	public planRoleId?: string
	public planConfiguration?: {
		ref: Ssh.ConfigurationReference
		individual?: Ssh.AlveolusConfiguration
	}

	constructor(
		tile: Tile,
		target: AlveolusType,
		constructionSite?: ConstructionSiteState,
		variantId?: string,
		/** Pre-resolved chain; if omitted, resolve from target/variantId. */
		chain?: readonly ConstructionRecipe[],
		/** Starting step index within chain. */
		stepIndex?: number
	) {
		const resolved = resolveAlveolusVariant(target, variantId)
		const ancestorChain = chain ?? resolved?.ancestorChain ?? []
		const activeStep = stepIndex ?? 0
		const recipe = ancestorChain[activeStep]
		const goods = (recipe?.goods ?? {}) as Record<GoodType, number>
		const coord = toAxialCoord(tile.position)!
		super(tile.board.game, `build-alveolus:${target}:${coord.q},${coord.r}`)
		this.tile = tile
		this.variantId = variantId
		this.targetVariantId = variantId
		this.constructionQueue = ancestorChain
		this.constructionStepIndex = activeStep
		this.storage = new SpecificStorage(goods)
		this.storage.setPresentationChangeNotifier(() =>
			this.game.enqueueStoragePresentationChange?.(this.tile)
		)

		this.target = target
		this.constructionSite = normalizeConstructionSiteState(
			constructionSite ?? createConstructionSiteState({ kind: 'alveolus', alveolusType: target, variantId })
		)
		if (['planned', 'foundation'].includes(this.constructionSite.phase)) {
			this.constructionSite.phase = 'waiting_materials'
		}
		registerConstructionMaterialPhaseEffect(`build-alveolus:${this.uid}`, this)
	}

	/** Next variantId after the current step completes (intermediate segment). */
	get nextVariantId(): string | undefined {
		if (this.constructionStepIndex + 1 >= this.constructionQueue.length) return undefined
		const nextIdx = this.constructionStepIndex + 1
		// Build the dot-path for the next step: e.g. "wood" at step 1 of "wood.extra"
		const segments = (this.targetVariantId ?? '').split('.')
		return segments.slice(0, nextIdx).join('.') || undefined
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
