import { describe, expect, it } from 'vitest'
import { classifyRiverBodyAngle } from './river-topology'

describe('classifyRiverBodyAngle', () => {
	it('classifies opposite edges as straight', () => {
		expect(classifyRiverBodyAngle([0, 3])).toBe('straight180')
		expect(classifyRiverBodyAngle([2, 5])).toBe('straight180')
	})

	it('classifies adjacent edges as 60-degree bends', () => {
		expect(classifyRiverBodyAngle([0, 1])).toBe('bend60')
		expect(classifyRiverBodyAngle([5, 0])).toBe('bend60')
	})

	it('classifies skip-one edges as 120-degree bends', () => {
		expect(classifyRiverBodyAngle([0, 2])).toBe('bend120')
		expect(classifyRiverBodyAngle([4, 0])).toBe('bend120')
	})

	it('returns undefined for non-degree-2 edge sets', () => {
		expect(classifyRiverBodyAngle([0, 1, 2])).toBeUndefined()
		expect(classifyRiverBodyAngle([0])).toBeUndefined()
		expect(classifyRiverBodyAngle([])).toBeUndefined()
	})
})
