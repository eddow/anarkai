import { axial, hexSides } from '../src/hex'
import { describe, expect, it } from 'vitest'

describe('axial neighbor directions', () => {
	it('keeps neighborIndex as the inverse of hexSides', () => {
		for (let direction = 0; direction < 6; direction++) {
			const side = hexSides[direction]!
			expect(axial.neighborIndex(side)).toBe(direction)
			expect(axial.neighborIndex({ q: side.q + 4, r: side.r - 3 }, { q: 4, r: -3 })).toBe(
				direction
			)
		}
	})
})
