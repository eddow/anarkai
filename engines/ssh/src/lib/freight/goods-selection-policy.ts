import { goods as goodsCatalog } from 'engine-rules'
import type { GoodType } from 'ssh/types/base'

export type GoodSelectionEffect = 'allow' | 'deny'
export type GoodSelectionTagMatch = 'present' | 'absent'

export interface GoodSelectionGoodRule {
	readonly goodType: GoodType
	readonly effect: GoodSelectionEffect
}

export interface GoodSelectionTagRule {
	readonly tag: string
	readonly match: GoodSelectionTagMatch
	readonly effect: GoodSelectionEffect
}

export interface GoodSelectionPolicy {
	readonly goodRules: ReadonlyArray<GoodSelectionGoodRule>
	readonly tagRules: ReadonlyArray<GoodSelectionTagRule>
	readonly defaultEffect: GoodSelectionEffect
}

export const FREIGHT_LINE_ALL_GOOD_TYPES = Object.keys(goodsCatalog) as GoodType[]

export function getDefaultGoodTags(good: GoodType): readonly string[] {
	return goodsCatalog[good]?.tags ?? []
}

export function goodHasTag(goodTags: readonly string[], ruleTag: string): boolean {
	const needle = ruleTag.trim()
	if (!needle.length) return false
	for (const tag of goodTags) {
		if (tag === needle || tag.startsWith(`${needle}/`)) return true
	}
	return false
}

export function normalizeGoodSelectionPolicy(policy: GoodSelectionPolicy): GoodSelectionPolicy {
	const goodRules: GoodSelectionGoodRule[] = []
	const seenGoods = new Set<GoodType>()
	for (const rule of policy.goodRules) {
		if (seenGoods.has(rule.goodType)) continue
		seenGoods.add(rule.goodType)
		goodRules.push({
			goodType: rule.goodType,
			effect: rule.effect === 'deny' ? 'deny' : 'allow',
		})
	}
	const tagRules: GoodSelectionTagRule[] = []
	for (const rule of policy.tagRules) {
		const tag = rule.tag.trim()
		if (!tag.length) continue
		tagRules.push({
			tag,
			match: rule.match === 'absent' ? 'absent' : 'present',
			effect: rule.effect === 'deny' ? 'deny' : 'allow',
		})
	}
	return {
		goodRules,
		tagRules,
		defaultEffect: policy.defaultEffect === 'deny' ? 'deny' : 'allow',
	}
}

export function isUnrestrictedGoodsSelectionPolicy(policy: GoodSelectionPolicy): boolean {
	return (
		policy.goodRules.length === 0 &&
		policy.tagRules.length === 0 &&
		policy.defaultEffect === 'allow'
	)
}

export const UNRESTRICTED_GOODS_SELECTION_POLICY: GoodSelectionPolicy = {
	goodRules: [],
	tagRules: [],
	defaultEffect: 'allow',
}

export function freightLineEditorGoodsSelectionPolicy(line: {
	readonly goodsSelection?: GoodSelectionPolicy
	readonly filters?: ReadonlyArray<GoodType>
}): GoodSelectionPolicy {
	const resolved = resolveFreightLineGoodsSelectionPolicy(line)
	if (!resolved || isUnrestrictedGoodsSelectionPolicy(resolved))
		return UNRESTRICTED_GOODS_SELECTION_POLICY
	return resolved
}

export function patchGoodsSelectionFromEditor(policy: GoodSelectionPolicy): {
	goodsSelection?: GoodSelectionPolicy
} {
	const normalized = normalizeGoodSelectionPolicy(policy)
	if (isUnrestrictedGoodsSelectionPolicy(normalized)) return { goodsSelection: undefined }
	return { goodsSelection: normalized }
}

export function migrateV1FiltersToGoodsSelection(
	filters: ReadonlyArray<GoodType>
): GoodSelectionPolicy {
	const unique: GoodType[] = []
	const seen = new Set<GoodType>()
	for (const good of filters) {
		if (seen.has(good)) continue
		seen.add(good)
		unique.push(good)
	}
	return {
		goodRules: unique.map((goodType) => ({ goodType, effect: 'allow' as const })),
		tagRules: [],
		defaultEffect: 'deny',
	}
}

export function resolveFreightLineGoodsSelectionPolicy(line: {
	readonly goodsSelection?: GoodSelectionPolicy
	readonly filters?: ReadonlyArray<GoodType>
}): GoodSelectionPolicy | undefined {
	const merged =
		line.goodsSelection ??
		(line.filters?.length ? migrateV1FiltersToGoodsSelection(line.filters) : undefined)
	return merged ? normalizeGoodSelectionPolicy(merged) : undefined
}

export function evaluateGoodSelectionPolicy(
	policy: GoodSelectionPolicy,
	good: GoodType,
	goodTags?: readonly string[]
): GoodSelectionEffect {
	const tags = goodTags ?? getDefaultGoodTags(good)
	for (const rule of policy.goodRules) {
		if (rule.goodType === good) return rule.effect
	}
	for (const rule of policy.tagRules) {
		const present = goodHasTag(tags, rule.tag)
		if (rule.match === 'present' && present) return rule.effect
		if (rule.match === 'absent' && !present) return rule.effect
	}
	return policy.defaultEffect
}

export function listGoodTypesMatchingSelectionPolicy(
	policy: GoodSelectionPolicy,
	candidates: readonly GoodType[] = FREIGHT_LINE_ALL_GOOD_TYPES
): GoodType[] {
	const normalized = normalizeGoodSelectionPolicy(policy)
	return candidates.filter((good) => evaluateGoodSelectionPolicy(normalized, good) === 'allow')
}

export function collectSortedDistinctTagsFromGoodsCatalog(
	catalog: Readonly<Record<string, { tags?: readonly string[] }>>
): string[] {
	const tags = new Set<string>()
	for (const def of Object.values(catalog)) {
		for (const tag of def.tags ?? []) tags.add(tag)
	}
	return [...tags].sort((a, b) => a.localeCompare(b))
}
