import { describe, expect, it } from 'vitest'
import { reorderWithInsertionGap } from './good-selection-tag-reorder'

describe('reorderWithInsertionGap', () => {
	it('returns an empty list unchanged', () => {
		expect(reorderWithInsertionGap([], 0, 0)).toEqual([])
	})

	it('moves an item downward using the pre-move insertion gap', () => {
		expect(reorderWithInsertionGap(['food', 'fuel', 'luxury'], 0, 2)).toEqual([
			'fuel',
			'food',
			'luxury',
		])
	})

	it('moves an item upward using the pre-move insertion gap', () => {
		expect(reorderWithInsertionGap(['food', 'fuel', 'luxury'], 2, 1)).toEqual([
			'food',
			'luxury',
			'fuel',
		])
	})

	it('keeps the original order when the move index is out of bounds', () => {
		const items = ['food', 'fuel', 'luxury']
		expect(reorderWithInsertionGap(items, -1, 1)).toEqual(items)
		expect(reorderWithInsertionGap(items, 3, 1)).toEqual(items)
	})
})
