import { normalizeFreightLineDefinition } from 'ssh/freight/freight-line'
import type { GoodSelectionPolicy } from 'ssh/freight/goods-selection-policy'
import {
	collectSortedDistinctTagsFromGoodsCatalog,
	evaluateGoodSelectionPolicy,
	goodHasTag,
	isUnrestrictedGoodsSelectionPolicy,
	listGoodTypesMatchingSelectionPolicy,
	migrateV1FiltersToGoodsSelection,
	patchGoodsSelectionFromEditor,
	resolveFreightLineGoodsSelectionPolicy,
	UNRESTRICTED_GOODS_SELECTION_POLICY,
} from 'ssh/freight/goods-selection-policy'
import type { GoodType } from 'ssh/types/base'
import { describe, expect, it } from 'vitest'
import { goods as goodsCatalog } from '../../assets/game-content'

describe('goods selection policy', () => {
	it('detects hierarchical tag presence', () => {
		expect(goodHasTag(['liquid/water'], 'liquid')).toBe(true)
		expect(goodHasTag(['liquid/water'], 'liquid/water')).toBe(true)
		expect(goodHasTag(['food'], 'liquid')).toBe(false)
	})

	it('evaluates good rules before tag rules', () => {
		const policy: GoodSelectionPolicy = {
			goodRules: [{ goodType: 'wood', effect: 'deny' }],
			tagRules: [{ tag: 'bulk', match: 'present', effect: 'allow' }],
			defaultEffect: 'deny',
		}
		expect(evaluateGoodSelectionPolicy(policy, 'wood')).toBe('deny')
		expect(evaluateGoodSelectionPolicy(policy, 'stone')).toBe('allow')
		expect(evaluateGoodSelectionPolicy(policy, 'berries')).toBe('deny')
	})

	it('uses first matching tag rule only', () => {
		const policy: GoodSelectionPolicy = {
			goodRules: [],
			tagRules: [
				{ tag: 'food', match: 'present', effect: 'deny' },
				{ tag: 'food', match: 'present', effect: 'allow' },
			],
			defaultEffect: 'allow',
		}
		expect(evaluateGoodSelectionPolicy(policy, 'berries')).toBe('deny')
	})

	it('lists goods allowed by a migrated v1 filter policy', () => {
		const policy = migrateV1FiltersToGoodsSelection(['wood', 'berries'])
		const allowed = listGoodTypesMatchingSelectionPolicy(policy)
		expect(new Set(allowed)).toEqual(new Set<GoodType>(['wood', 'berries']))
	})

	it('normalizes freight lines by merging legacy filters into goodsSelection', () => {
		const normalized = normalizeFreightLineDefinition({
			id: 'L',
			name: 'Line',
			mode: 'gather',
			stops: [{ hiveName: 'H', alveolusType: 'freight_bay', coord: [0, 0] }],
			filters: ['wood', 'wood', 'berries'],
			radius: 2,
		})
		expect(normalized.filters).toBeUndefined()
		expect(normalized.goodsSelection).toEqual({
			goodRules: [
				{ goodType: 'wood', effect: 'allow' },
				{ goodType: 'berries', effect: 'allow' },
			],
			tagRules: [],
			defaultEffect: 'deny',
		})
	})

	it('resolves policies from either goodsSelection or legacy filters', () => {
		const fromFilters = resolveFreightLineGoodsSelectionPolicy({
			filters: ['stone'],
		})
		expect(fromFilters).toEqual(migrateV1FiltersToGoodsSelection(['stone']))

		const fromSelection = resolveFreightLineGoodsSelectionPolicy({
			goodsSelection: {
				goodRules: [],
				tagRules: [{ tag: 'food', match: 'present', effect: 'allow' }],
				defaultEffect: 'deny',
			},
		})
		expect(fromSelection?.tagRules[0]?.tag).toBe('food')
	})

	it('collects distinct tags from the goods catalog', () => {
		const tags = collectSortedDistinctTagsFromGoodsCatalog(goodsCatalog)
		expect(tags.includes('food')).toBe(true)
		expect(tags.includes('construction/lumber')).toBe(true)
	})

	it('treats unrestricted editor policy as undefined patch payload', () => {
		expect(patchGoodsSelectionFromEditor(UNRESTRICTED_GOODS_SELECTION_POLICY)).toEqual({
			goodsSelection: undefined,
		})
		expect(isUnrestrictedGoodsSelectionPolicy(UNRESTRICTED_GOODS_SELECTION_POLICY)).toBe(true)
	})
})
