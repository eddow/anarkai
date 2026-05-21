import { describe, expect, it } from 'vitest'
import {
	coordsForSectorBakeDomain,
	coordsForSectorInterior,
	sectorKeyForCoord,
} from './terrain-sector-topology'

describe('terrain-sector-topology', () => {
	describe('sectorKeyForCoord', () => {
		it('correctly maps positive coordinates to sector keys', () => {
			expect(sectorKeyForCoord({ q: 0, r: 0 })).toBe('0,0')
			expect(sectorKeyForCoord({ q: 16, r: 16 })).toBe('0,0')
			expect(sectorKeyForCoord({ q: 17, r: 0 })).toBe('1,0')
			expect(sectorKeyForCoord({ q: 0, r: 17 })).toBe('0,1')
			expect(sectorKeyForCoord({ q: 17, r: 17 })).toBe('1,1')
		})

		it('correctly maps negative coordinates to sector keys (edge case fix)', () => {
			// This is the edge case that caused the rendering bug
			// With Math.floor, -29/17 = -1.705... would become -2 (incorrect)
			// With the fixed formula, -29 is in range -34 to -18, so sector -2 (correct)
			expect(sectorKeyForCoord({ q: -29, r: -26 })).toBe('-2,-2')
			expect(sectorKeyForCoord({ q: -17, r: 0 })).toBe('-1,0')
			expect(sectorKeyForCoord({ q: 0, r: -17 })).toBe('0,-1')
			expect(sectorKeyForCoord({ q: -17, r: -17 })).toBe('-1,-1')
			expect(sectorKeyForCoord({ q: -18, r: 0 })).toBe('-2,0')
			expect(sectorKeyForCoord({ q: -34, r: 0 })).toBe('-2,0')
		})

		it('correctly maps mixed positive/negative coordinates', () => {
			expect(sectorKeyForCoord({ q: -16, r: 16 })).toBe('-1,0')
			expect(sectorKeyForCoord({ q: 16, r: -16 })).toBe('0,-1')
			expect(sectorKeyForCoord({ q: -17, r: 16 })).toBe('-1,0')
			expect(sectorKeyForCoord({ q: 16, r: -17 })).toBe('0,-1')
		})

		it('maintains consistent sector boundaries across coordinate ranges', () => {
			// All tiles from 0 to 16 should be in sector 0
			for (let q = 0; q <= 16; q++) {
				for (let r = 0; r <= 16; r++) {
					expect(sectorKeyForCoord({ q, r })).toBe('0,0')
				}
			}

			// All tiles from 17 to 33 should be in sector 1
			for (let q = 17; q <= 33; q++) {
				for (let r = 17; r <= 33; r++) {
					expect(sectorKeyForCoord({ q, r })).toBe('1,1')
				}
			}

			// All tiles where both coordinates are from -17 to -1 should be in sector -1
			for (let q = -17; q <= -1; q++) {
				for (let r = -17; r <= -1; r++) {
					expect(sectorKeyForCoord({ q, r })).toBe('-1,-1')
				}
			}

			// All tiles where both coordinates are from -34 to -18 should be in sector -2
			for (let q = -34; q <= -18; q++) {
				for (let r = -34; r <= -18; r++) {
					expect(sectorKeyForCoord({ q, r })).toBe('-2,-2')
				}
			}
		})
	})

	describe('coordsForSectorInterior', () => {
		it('returns correct tile coordinates for positive sector', () => {
			const coords = coordsForSectorInterior('0,0')
			expect(coords).toHaveLength(289) // 17x17
			expect(coords[0]).toEqual({ q: 0, r: 0 })
			expect(coords[coords.length - 1]).toEqual({ q: 16, r: 16 })
		})

		it('returns correct tile coordinates for negative sector', () => {
			const coords = coordsForSectorInterior('-1,-1')
			expect(coords).toHaveLength(289) // 17x17
			expect(coords[0]).toEqual({ q: -17, r: -17 })
			expect(coords[coords.length - 1]).toEqual({ q: -1, r: -1 })
		})

		it('returns correct tile coordinates for mixed sector', () => {
			const coords = coordsForSectorInterior('-1,0')
			expect(coords).toHaveLength(289) // 17x17
			expect(coords[0]).toEqual({ q: -17, r: 0 })
			expect(coords[coords.length - 1]).toEqual({ q: -1, r: 16 })
		})
	})

	describe('coordsForSectorBakeDomain', () => {
		it('includes interior tiles plus neighbor expansion', () => {
			const coords = coordsForSectorBakeDomain('0,0')
			const interior = coordsForSectorInterior('0,0')
			expect(coords.length).toBeGreaterThan(interior.length)
		})
	})
})
