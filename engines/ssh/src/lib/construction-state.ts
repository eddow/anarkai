import { alveoli } from 'engine-rules'
import { reactive } from 'mutts'
import { residentialBasicDwellingProject } from 'ssh/residential/constants'
import type { AlveolusType, GoodType } from 'ssh/types/base'

export type ConstructionPhase =
	| 'planned'
	| 'foundation'
	| 'waiting_materials'
	| 'waiting_construction'
	| 'building'
	| 'failed'

export type ConstructionBlockingReason =
	| 'tile_not_clear'
	| 'no_engineer_in_range'
	| 'engineer_hive_paused'
	| 'construction_site_paused'
	| 'missing_goods'

export type DwellingTier = 'basic_dwelling'

export type ConstructionTarget =
	| { readonly kind: 'alveolus'; readonly alveolusType: AlveolusType }
	| { readonly kind: 'dwelling'; readonly tier: DwellingTier }

export interface ConstructionRecipe {
	readonly goods: Partial<Record<GoodType, number>>
	readonly workSeconds: number
}

export interface ConstructionSiteState {
	target: ConstructionTarget
	recipe: ConstructionRecipe
	phase: ConstructionPhase
	requiredGoods: Partial<Record<GoodType, number>>
	deliveredGoods: Partial<Record<GoodType, number>>
	consumedGoods: Partial<Record<GoodType, number>>
	workSecondsApplied: number
	blockingReasons: ConstructionBlockingReason[]
}

const dwellingRecipeByTier: Readonly<Record<DwellingTier, ConstructionRecipe>> = {
	basic_dwelling: { goods: { wood: 2, planks: 1 }, workSeconds: 5 },
}

export function constructionTargetFromProject(project: string): ConstructionTarget | undefined {
	if (project === residentialBasicDwellingProject) {
		return { kind: 'dwelling', tier: 'basic_dwelling' }
	}
	if (!project.startsWith('build:')) return undefined
	const alveolusType = project.slice('build:'.length) as AlveolusType
	return { kind: 'alveolus', alveolusType }
}

export function createConstructionRecipe(target: ConstructionTarget): ConstructionRecipe {
	if (target.kind === 'alveolus') {
		const def = alveoli[target.alveolusType as keyof typeof alveoli]
		return {
			goods: { ...((def?.construction?.goods ?? {}) as Partial<Record<GoodType, number>>) },
			workSeconds: def?.construction?.time ?? 0,
		}
	}
	if (target.kind === 'dwelling') {
		return { ...dwellingRecipeByTier[target.tier] }
	}
	throw new Error('Unsupported construction target')
}

export function createConstructionSiteState(target: ConstructionTarget): ConstructionSiteState {
	const recipe = createConstructionRecipe(target)
	return reactive({
		target,
		recipe,
		phase: 'planned' as ConstructionPhase,
		requiredGoods: { ...recipe.goods },
		deliveredGoods: {},
		consumedGoods: {},
		workSecondsApplied: 0,
		blockingReasons: [],
	})
}

export function setConstructionDeliveredGoods(
	state: ConstructionSiteState,
	goods: Partial<Record<GoodType, number>>
) {
	state.deliveredGoods = { ...goods }
}

export function setConstructionConsumedGoods(
	state: ConstructionSiteState,
	goods: Partial<Record<GoodType, number>>
) {
	state.consumedGoods = { ...goods }
}
