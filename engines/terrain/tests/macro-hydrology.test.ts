import { describe, expect, it, beforeAll } from 'vitest'
import {
	generateMacroHydrologyWasm,
	ensureWasmLoaded,
	DEFAULT_MACRO_HYDROLOGY_SECTOR_RADIUS,
	DEFAULT_MACRO_HYDROLOGY_STEP,
} from '../src'

describe('macro hydrology', () => {
	beforeAll(async () => {
		await ensureWasmLoaded()
	})

	it('unpacks deterministic macro river segments from WASM', () => {
		const a = generateMacroHydrologyWasm(42, { q: 0, r: 0 })
		const b = generateMacroHydrologyWasm(42, { q: 0, r: 0 })

		expect(a.sectorRadius).toBe(DEFAULT_MACRO_HYDROLOGY_SECTOR_RADIUS)
		expect(a.macroStep).toBe(DEFAULT_MACRO_HYDROLOGY_STEP)
		expect(a.macroTileCount).toBeGreaterThan(0)
		expect(a.tiles).toHaveLength(a.macroTileCount)
		expect(a.tiles).toEqual(b.tiles)
		expect(a.tiles[0]?.biome).toBeDefined()
		expect(Number.isFinite(a.tiles[0]?.height ?? Number.NaN)).toBe(true)
		expect(a.riverSegmentCount).toBe(a.segments.length)
		expect(a.segments).toEqual(b.segments)
		for (const segment of a.segments) {
			expect(Number.isFinite(segment.flux)).toBe(true)
			expect(Number.isFinite(segment.width)).toBe(true)
			expect(segment.order).toBeGreaterThanOrEqual(1)
		}
	})

	it('uses far fewer macro cells than a full tile footprint', () => {
		const snapshot = generateMacroHydrologyWasm(42, { q: 0, r: 0 })
		const tileDiameter = snapshot.sectorRadius * 2 * snapshot.sectorStep

		expect(snapshot.macroTileCount).toBeLessThan(tileDiameter * tileDiameter)
		expect(snapshot.macroTileCount).toBeLessThan(3000)
	})
})
