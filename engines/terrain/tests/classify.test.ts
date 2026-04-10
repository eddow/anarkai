import { classifyTile } from 'terrain/classify'
import { generate } from 'terrain/generate'
import { axial } from 'terrain/hex'
import { DEFAULT_TERRAIN_CONFIG, type TileField } from 'terrain/types'
import { describe, expect, it } from 'vitest'

function tile(overrides: Partial<TileField>): TileField {
	return {
		height: 0.02,
		temperature: 0.0,
		humidity: 0.0,
		terrainType: 0.0,
		rockyNoise: 0.0,
		sediment: 0,
		waterTable: 0,
		...overrides,
	}
}

const cfg = DEFAULT_TERRAIN_CONFIG
const DISTRIBUTION_SEEDS = [0, 7, 42, 100, 999]

function biomeCounts(boardSize: number, seed: number): Map<string, number> {
	const counts = new Map<string, number>()
	const snap = generate(seed, boardSize, { fieldBackend: 'cpu' })
	for (const biome of snap.biomes.values()) {
		counts.set(biome, (counts.get(biome) ?? 0) + 1)
	}
	return counts
}

function largestCluster(boardSize: number, seed: number, wanted: Set<string>): number {
	const snap = generate(seed, boardSize, { fieldBackend: 'cpu' })
	const remaining = new Set(
		[...snap.biomes.entries()].filter(([, biome]) => wanted.has(biome)).map(([key]) => key)
	)
	let best = 0

	while (remaining.size > 0) {
		const start = remaining.values().next().value as string
		remaining.delete(start)
		const queue = [start]
		let size = 0

		while (queue.length > 0) {
			const key = queue.pop()!
			size++
			for (const neighbor of axial.neighbors(axial.coord(key))) {
				const neighborKey = axial.key(neighbor)
				if (!remaining.has(neighborKey)) continue
				remaining.delete(neighborKey)
				queue.push(neighborKey)
			}
		}

		best = Math.max(best, size)
	}

	return best
}

describe('classifyTile()', () => {
	it('low height -> ocean', () => {
		expect(classifyTile(tile({ height: -0.2 }), [], cfg)).toBe('ocean')
	})

	it('high height -> snow', () => {
		expect(classifyTile(tile({ height: 0.2 }), [], cfg)).toBe('snow')
	})

	it('hot + dry -> sand', () => {
		expect(classifyTile(tile({ height: cfg.forestLevel - 0.01 }), [], cfg)).toBe('sand')
	})

	it('midland terrainType > 0 -> forest', () => {
		expect(classifyTile(tile({ height: 0.05, terrainType: 0.1 }), [], cfg)).toBe('forest')
	})

	it('default midland terrainType <= 0 -> grass', () => {
		expect(classifyTile(tile({ height: 0.02, terrainType: -0.1 }), [], cfg)).toBe('grass')
	})

	it('rocky at high elevation below snow', () => {
		expect(classifyTile(tile({ height: (cfg.rockyLevel + cfg.snowLevel) / 2 }), [], cfg)).toBe(
			'rocky'
		)
	})

	it('wetland: low height + very humid', () => {
		expect(classifyTile(tile({ height: cfg.seaLevel + 0.01, humidity: 0.2 }), [], cfg)).toBe(
			'sand'
		)
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

	it('multi-seed boards now favor stronger coasts and clearer relief bands', () => {
		const oceanShares: number[] = []
		const greenShares: number[] = []
		const highlandShares: number[] = []
		const riverShares: number[] = []

		for (const seed of DISTRIBUTION_SEEDS) {
			const counts = biomeCounts(24, seed)
			const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
			const oceanShare = ((counts.get('ocean') ?? 0) + (counts.get('lake') ?? 0)) / total
			const greenShare = ((counts.get('grass') ?? 0) + (counts.get('forest') ?? 0)) / total
			const highlandShare = ((counts.get('rocky') ?? 0) + (counts.get('snow') ?? 0)) / total
			const riverShare = (counts.get('river-bank') ?? 0) / total

			oceanShares.push(oceanShare)
			greenShares.push(greenShare)
			highlandShares.push(highlandShare)
			riverShares.push(riverShare)
		}

		expect(oceanShares.reduce((sum, share) => sum + share, 0) / oceanShares.length).toBeGreaterThan(
			0.35
		)
		expect(Math.min(...oceanShares)).toBeGreaterThan(0.2)
		expect(Math.max(...greenShares)).toBeLessThan(0.32)
		expect(Math.min(...highlandShares)).toBeGreaterThan(0.1)
		expect(Math.max(...riverShares)).toBeLessThan(0.38)
	})

	it('representative seeds include a large contiguous water body', () => {
		for (const seed of DISTRIBUTION_SEEDS) {
			expect(largestCluster(24, seed, new Set(['ocean', 'lake']))).toBeGreaterThan(300)
		}
	})

	it('representative seeds include visible highland clusters', () => {
		for (const seed of DISTRIBUTION_SEEDS) {
			expect(largestCluster(24, seed, new Set(['rocky', 'snow']))).toBeGreaterThan(50)
		}
	})
})
