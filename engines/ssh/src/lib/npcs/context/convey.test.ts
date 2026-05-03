import { describe, expect, it } from 'vitest'
import { getConveyDuration, getConveyVisualMovements } from './convey'

describe('convey helpers', () => {
	it('keeps the original origin for visual interpolation', () => {
		const moving = { position: { q: 0, r: 0 } }
		const [movement] = getConveyVisualMovements([
			{
				moving,
				from: { q: 1, r: 2 },
				hop: { q: 1.5, r: 2.5 },
			},
		])

		expect(movement?.who).toBe(moving)
		expect(movement?.from).toEqual({ q: 1, r: 2 })
		expect(movement?.to).toEqual({ q: 1.5, r: 2.5 })
	})

	it('scales convey duration with hop distance and cycle size', () => {
		expect(
			getConveyDuration(1.5, [
				{ from: { q: 0, r: 0 }, hop: { q: 0.5, r: 0.5 } },
				{ from: { q: 1, r: 0 }, hop: { q: 1.5, r: 0.5 } },
			])
		).toBe(6)
	})

	it('charges one transfer unit for same-tile handoffs', () => {
		expect(getConveyDuration(1.5, [{ from: { q: 11, r: -7 }, hop: { q: 11, r: -7 } }])).toBe(1.5)
	})
})
