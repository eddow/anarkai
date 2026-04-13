import { describe, expect, it } from 'vitest'
import { getBorderGoodsPositions } from './border-visual'

describe('getBorderGoodsPositions', () => {
	it('keeps stored goods on the border segment', () => {
		const center = { x: 100, y: 200 }
		const direction = { dx: 0, dy: 60 }
		const positions = getBorderGoodsPositions(center, direction, 24, 2)

		expect(positions).toEqual([
			{ x: 100, y: 196 },
			{ x: 100, y: 204 },
		])
	})

	it('returns centered positions for a zero-length direction', () => {
		const center = { x: 100, y: 200 }

		expect(getBorderGoodsPositions(center, { dx: 0, dy: 0 }, 24, 2)).toEqual([
			{ x: 100, y: 200 },
			{ x: 100, y: 200 },
		])
	})
})
