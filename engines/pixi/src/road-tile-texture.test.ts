import { describe, expect, it } from 'vitest'
import { blendRoadPixel, roadMaterialSeedUv } from './road-tile-texture'

describe('road tile texture helpers', () => {
	it('derives stable but varied material uv seeds from border coordinates', () => {
		const first = roadMaterialSeedUv({ q: 0.5, r: 0 })
		const again = roadMaterialSeedUv({ q: 0.5, r: 0 })
		const other = roadMaterialSeedUv({ q: 1.5, r: 0 })

		expect(first).toEqual(again)
		expect(first).not.toEqual(other)
		expect(first.u).toBeGreaterThanOrEqual(0)
		expect(first.u).toBeLessThan(1)
		expect(first.v).toBeGreaterThanOrEqual(0)
		expect(first.v).toBeLessThan(1)
	})

	it('clips accumulated alpha and alpha-weights mixed colors', () => {
		expect(
			blendRoadPixel([
				{ color: [100, 0, 0], alpha: 0.75 },
				{ color: [0, 100, 0], alpha: 0.75 },
			])
		).toEqual([50, 50, 0, 255])

		expect(blendRoadPixel([{ color: [10, 20, 30], alpha: 0.5 }])).toEqual([10, 20, 30, 128])
	})
})
