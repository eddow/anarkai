import { describe, expect, it } from 'vitest'
import { reorderWithInsertionGap } from './good-selection-tag-reorder'

describe('reorderWithInsertionGap', () => {
	it('moves an item to the end', () => {
		expect(reorderWithInsertionGap(['A', 'B', 'C'], 0, 3)).toEqual(['B', 'C', 'A'])
	})

	it('moves an item to the start', () => {
		expect(reorderWithInsertionGap(['A', 'B', 'C'], 2, 0)).toEqual(['C', 'A', 'B'])
	})

	it('moves an item between neighbours', () => {
		expect(reorderWithInsertionGap(['A', 'B', 'C'], 0, 2)).toEqual(['B', 'A', 'C'])
	})

	it('no-ops when insertion gap matches the current index', () => {
		expect(reorderWithInsertionGap(['A', 'B', 'C'], 1, 1)).toEqual(['A', 'B', 'C'])
		expect(reorderWithInsertionGap(['A', 'B', 'C'], 1, 2)).toEqual(['A', 'B', 'C'])
	})

	it('returns a copy when fromIndex is out of range', () => {
		const input = ['A', 'B']
		expect(reorderWithInsertionGap(input, -1, 0)).toEqual(['A', 'B'])
		expect(reorderWithInsertionGap(input, 5, 0)).toEqual(['A', 'B'])
	})
})
