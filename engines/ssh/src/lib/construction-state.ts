import { alveoli, construction } from 'engine-rules'
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
	| { readonly kind: 'alveolus'; readonly alveolusType: AlveolusType; readonly variantId?: string }
	| { readonly kind: 'dwelling'; readonly tier: DwellingTier }

export interface ConstructionRecipe {
	readonly goods: Partial<Record<GoodType, number>>
	readonly workSeconds: number
}

/**
 * Result of resolving an alveolus variant against the rules.
 * `definition` is the merged behavior (root action overridden by variant action if present).
 * `construction` is the recipe for the LAST hop in the chain.
 * `ancestorChain` lists every construction recipe from current state through each segment
 * (e.g. for "wood.extra": [root→wood, wood→extra]).
 */
export interface ResolvedAlveolusVariant {
	definition: Ssh.AlveolusDefinition
	/** Recipe for the final hop (leaf variant's construction). */
	construction: ConstructionRecipe
	/** Dot-separated variant path (e.g., "wood.extra"), or undefined for root. */
	variantId?: string
	/** The raw variant definition (for spec access), or undefined for root. */
	variantDef?: Ssh.AlveolusVariantDefinition
	/**
	 * Ordered list of construction recipes from current state to the final variant.
	 * First entry is the root's construction recipe, then each successive variant segment.
	 * For a root-only alveolus this is a single-element array.
	 */
	ancestorChain: ConstructionRecipe[]
}

/** Project string delimiter for variant encoding: `build:type#variant.path` */
export const VARIANT_DELIMITER = '#'

/** Splits a project string into base type + optional variant */
export function parseBuildActionProject(action: string): {
	alveolusType: AlveolusType
	variantId?: string
} | undefined {
	const raw = action.startsWith('build:') ? action.slice('build:'.length) : action
	const hashIdx = raw.indexOf(VARIANT_DELIMITER)
	if (hashIdx >= 0) {
		return { alveolusType: raw.slice(0, hashIdx) as AlveolusType, variantId: raw.slice(hashIdx + 1) }
	}
	return { alveolusType: raw as AlveolusType }
}

/**
 * Walk variant segments on a root alveolus definition and return the merged result.
 * Falls back to root if any segment is missing.
 */
export function resolveAlveolusVariant(
	alveolusType: AlveolusType,
	variantId?: string
): ResolvedAlveolusVariant | undefined {
	const root = alveoli[alveolusType as keyof typeof alveoli] as Ssh.AlveolusDefinition | undefined
	if (!root) return undefined

	const rootRecipe: ConstructionRecipe = {
		goods: { ...((root.construction?.goods ?? {}) as Partial<Record<GoodType, number>>) },
		workSeconds: root.construction?.time ?? 0,
	}

	const segments = variantId ? variantId.split('.') : []
	if (segments.length === 0) {
		return {
			definition: root,
			construction: rootRecipe,
			ancestorChain: [rootRecipe],
		}
	}

	const chain: ConstructionRecipe[] = [rootRecipe]
	let currentDef: Ssh.AlveolusDefinition = root
	let currentVariant: Ssh.AlveolusVariantDefinition | undefined
	let mergeAction: Ssh.Action = root.action
	const resolvedSegments: string[] = []

	for (const segment of segments) {
		const variants = currentDef.variants as Record<string, Ssh.AlveolusVariantDefinition> | undefined
		const found = variants?.[segment]
		if (!found) {
			console.warn(
				`[resolveAlveolusVariant] Unknown variant "${variantId}" for "${alveolusType}"; falling back to "${resolvedSegments.join('.') || '(root)'}"`
			)
			return {
				definition: { ...currentDef, action: mergeAction },
				construction: chain[chain.length - 1],
				variantId: resolvedSegments.length ? resolvedSegments.join('.') : undefined,
				variantDef: currentVariant,
				ancestorChain: chain,
			}
		}

		currentVariant = found
		resolvedSegments.push(segment)
		const stepRecipe: ConstructionRecipe = {
			goods: { ...((found.construction?.goods ?? {}) as Partial<Record<GoodType, number>>) },
			workSeconds: found.construction?.time ?? 0,
		}
		chain.push(stepRecipe)

		if (found.action) mergeAction = found.action
		if (found.variants || found.action) {
			currentDef = { ...currentDef, action: mergeAction, variants: found.variants }
		}
	}

	return {
		definition: { ...currentDef, action: mergeAction },
		construction: chain[chain.length - 1],
		variantId: resolvedSegments.join('.'),
		variantDef: currentVariant,
		ancestorChain: chain,
	}
}

/**
 * Parse a project string like `build:pile` or `build:pile#wood.extra`
 * into a ConstructionTarget with optional variantId.
 */
function parseBuildProject(project: string): { alveolusType: AlveolusType; variantId?: string } | undefined {
	const raw = project.slice('build:'.length)
	const hashIdx = raw.indexOf(VARIANT_DELIMITER)
	if (hashIdx >= 0) {
		return {
			alveolusType: raw.slice(0, hashIdx) as AlveolusType,
			variantId: raw.slice(hashIdx + 1),
		}
	}
	return { alveolusType: raw as AlveolusType }
}

export interface ConstructionSiteState {
	target: ConstructionTarget
	recipe: ConstructionRecipe
	foundationRequiredGoods: Partial<Record<GoodType, number>>
	foundationDeliveredGoods: Partial<Record<GoodType, number>>
	foundationConsumedGoods: Partial<Record<GoodType, number>>
	foundationWorkSeconds: number
	phase: ConstructionPhase
	requiredGoods: Partial<Record<GoodType, number>>
	deliveredGoods: Partial<Record<GoodType, number>>
	consumedGoods: Partial<Record<GoodType, number>>
	workSecondsApplied: number
	blockingReasons: ConstructionBlockingReason[]
}

function ruleConstructionRecipe(rule: { goods: object; time: number }): ConstructionRecipe {
	return {
		goods: { ...(rule.goods as Partial<Record<GoodType, number>>) },
		workSeconds: rule.time,
	}
}

const dwellingRecipeByTier: Readonly<Record<DwellingTier, ConstructionRecipe>> = {
	basic_dwelling: ruleConstructionRecipe(construction.dwellings.basic_dwelling),
}

export function constructionTargetFromProject(project: string): ConstructionTarget | undefined {
	if (project === residentialBasicDwellingProject) {
		return { kind: 'dwelling', tier: 'basic_dwelling' }
	}
	if (!project.startsWith('build:')) return undefined
	const parsed = parseBuildProject(project)
	if (!parsed) return undefined
	return { kind: 'alveolus', alveolusType: parsed.alveolusType, variantId: parsed.variantId }
}

export function createConstructionRecipe(target: ConstructionTarget): ConstructionRecipe {
	if (target.kind === 'alveolus') {
		const resolved = resolveAlveolusVariant(target.alveolusType, target.variantId)
		if (resolved) {
			return {
				goods: { ...((resolved.construction.goods ?? {}) as Partial<Record<GoodType, number>>) },
				workSeconds: resolved.construction.workSeconds,
			}
		}
		// Fallback for unknown types
		const def = alveoli[target.alveolusType as keyof typeof alveoli] as Ssh.AlveolusDefinition | undefined
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

/** Reconstitute a project string from a ConstructionTarget (e.g., "build:pile#wood.extra"). */
export function projectFromConstructionTarget(target: ConstructionTarget): string {
	if (target.kind === 'dwelling') return residentialBasicDwellingProject
	if (target.variantId) {
		return `build:${target.alveolusType}${VARIANT_DELIMITER}${target.variantId}`
	}
	return `build:${target.alveolusType}`
}

export function createConstructionSiteState(target: ConstructionTarget): ConstructionSiteState {
	const recipe = createConstructionRecipe(target)
	const foundationRecipe = ruleConstructionRecipe(construction.foundation)
	return normalizeConstructionSiteState(
		reactive({
			target,
			recipe,
			foundationRequiredGoods: { ...foundationRecipe.goods },
			foundationDeliveredGoods: {},
			foundationConsumedGoods: {},
			foundationWorkSeconds: foundationRecipe.workSeconds,
			phase: 'planned' as ConstructionPhase,
			requiredGoods: { ...recipe.goods },
			deliveredGoods: {},
			consumedGoods: {},
			workSecondsApplied: 0,
			blockingReasons: [],
		})
	)
}

function goodsEqual(
	a: Partial<Record<GoodType, number>> | undefined,
	b: Partial<Record<GoodType, number>>
): boolean {
	const aKeys = Object.keys(a ?? {})
	const bKeys = Object.keys(b)
	if (aKeys.length !== bKeys.length) return false
	return bKeys.every((good) => (a?.[good as GoodType] ?? 0) === (b[good as GoodType] ?? 0))
}

/**
 * Construction cost is target-derived, not an optional runtime cache.
 *
 * Some older/transient shells can carry a partial `constructionSite`; normalize before exposing
 * materials so UI, advertisements, and convey planning all see the same recipe demand.
 */
export function normalizeConstructionSiteState(
	state: ConstructionSiteState
): ConstructionSiteState {
	const recipe = createConstructionRecipe(state.target)
	const foundationRecipe = ruleConstructionRecipe(construction.foundation)
	if (
		!state.recipe ||
		state.recipe.workSeconds !== recipe.workSeconds ||
		!goodsEqual(state.recipe.goods, recipe.goods)
	) {
		state.recipe = {
			goods: { ...recipe.goods },
			workSeconds: recipe.workSeconds,
		}
	}
	if (!goodsEqual(state.requiredGoods, recipe.goods)) {
		state.requiredGoods = { ...recipe.goods }
	}
	if (!goodsEqual(state.foundationRequiredGoods, foundationRecipe.goods)) {
		state.foundationRequiredGoods = { ...foundationRecipe.goods }
	}
	if (!state.foundationDeliveredGoods) state.foundationDeliveredGoods = {}
	if (!state.foundationConsumedGoods) state.foundationConsumedGoods = {}
	if (state.foundationWorkSeconds === undefined) {
		state.foundationWorkSeconds = foundationRecipe.workSeconds
	}
	if (!state.deliveredGoods) state.deliveredGoods = {}
	if (!state.consumedGoods) state.consumedGoods = {}
	if (state.workSecondsApplied === undefined) state.workSecondsApplied = 0
	if (!state.blockingReasons) state.blockingReasons = []
	if (!state.phase) state.phase = 'planned'
	return state
}

export function setConstructionFoundationDeliveredGoods(
	state: ConstructionSiteState,
	goods: Partial<Record<GoodType, number>>
) {
	state.foundationDeliveredGoods = { ...goods }
}

export function setConstructionFoundationConsumedGoods(
	state: ConstructionSiteState,
	goods: Partial<Record<GoodType, number>>
) {
	state.foundationConsumedGoods = { ...goods }
}

export function foundationGoodsComplete(state: ConstructionSiteState): boolean {
	const normalized = normalizeConstructionSiteState(state)
	for (const [good, qty] of Object.entries(normalized.foundationRequiredGoods)) {
		const delivered = normalized.foundationDeliveredGoods[good as GoodType] ?? 0
		if (delivered < (qty ?? 0)) return false
	}
	return true
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
