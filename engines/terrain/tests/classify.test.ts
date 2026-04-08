import { classifyTile } from 'terrain/classify'
import { generate } from 'terrain/generate'
import { DEFAULT_TERRAIN_CONFIG, type TileField } from 'terrain/types'
import { describe, expect, it } from 'vitest'

function tile(overrides: Partial<TileField>): TileField {
	return { height: 0.02, temperature: 0.0, humidity: 0.0, sediment: 0, waterTable: 0, ...overrides }
}

const cfg = DEFAULT_TERRAIN_CONFIG

describe('classifyTile()', () => {
	it('low height -> ocean', () => {
		expect(classifyTile(tile({ height: -0.2 }), [], cfg)).toBe('ocean')
	})

	it('high height -> snow', () => {
		expect(classifyTile(tile({ height: 0.2 }), [], cfg)).toBe('snow')
	})

	it('hot + dry -> sand', () => {
		expect(classifyTile(tile({ height: 0.02, temperature: 0.3, humidity: -0.2 }), [], cfg)).toBe(
			'sand'
		)
	})

	it('moderate height + humid -> forest', () => {
		expect(classifyTile(tile({ height: 0.05, humidity: 0.1 }), [], cfg)).toBe('forest')
	})

	it('default -> grass', () => {
		expect(classifyTile(tile({ height: 0.02, temperature: 0.0, humidity: -0.1 }), [], cfg)).toBe(
			'grass'
		)
	})

	it('rocky at high elevation below snow', () => {
		expect(classifyTile(tile({ height: 0.12 }), [], cfg)).toBe('rocky')
	})

	it('wetland: low height + very humid', () => {
		expect(classifyTile(tile({ height: -0.03, humidity: 0.2 }), [], cfg)).toBe('wetland')
	})

	it('bank influence marks land tile as river-bank even without direct flux on all sides', () => {
		expect(classifyTile(tile({ height: 0.02 }), [], cfg, { bankInfluence: 1.5 })).toBe('river-bank')
	})

	it('strong channel influence can widen a lowland river tile into lake biome', () => {
		expect(
			classifyTile(
				tile({ height: -0.02 }),
				[{ flux: 14, width: 4, depth: 2, slope: 0.1 }],
				cfg,
				{ channelInfluence: 1.4 }
			)
		).toBe('lake')
	})
})

describe('biome distribution sanity', () => {
	it('large board has at least 3 distinct biomes', () => {
		const snap = generate(42, 12)
		const biomeSet = new Set(snap.biomes.values())
		expect(biomeSet.size).toBeGreaterThanOrEqual(3)
	})

	it('across several seeds, both land and water appear', () => {
		const allBiomes = new Set<string>()
		for (const seed of [0, 7, 42, 100, 999]) {
			const snap = generate(seed, 12)
			for (const b of snap.biomes.values()) allBiomes.add(b)
		}
		const hasWater = allBiomes.has('ocean') || allBiomes.has('lake')
		const hasLand =
			allBiomes.has('grass') ||
			allBiomes.has('forest') ||
			allBiomes.has('sand') ||
			allBiomes.has('rocky') ||
			allBiomes.has('snow')
		expect(hasWater).toBe(true)
		expect(hasLand).toBe(true)
	})
})
