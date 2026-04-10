import { generate } from 'terrain/generate'
import { axial } from 'terrain/hex'
import type { AxialCoord } from 'terrain/hex/types'
import { isSpring, runHydrology, runHydrologyDetailed } from 'terrain/hydrology'
import { DEFAULT_TERRAIN_CONFIG, type TileField } from 'terrain/types'
import { describe, expect, it } from 'vitest'

function baseTile(overrides: Partial<TileField> = {}): TileField {
	return {
		height: 0,
		temperature: 0,
		humidity: 0,
		terrainType: 0,
		rockyNoise: 0,
		sediment: 0,
		waterTable: 0,
		...overrides,
	}
}

describe('isSpring()', () => {
	const cfg = {
		...DEFAULT_TERRAIN_CONFIG,
		hydrologySourcesPerTile: 0,
	}

	it('never springs when hydrologySourcesPerTile is 0', () => {
		for (const coord of axial.enum(2)) {
			expect(isSpring(coord, 0.2, 42, cfg)).toBe(false)
		}
	})

	it('below sea level is never a spring', () => {
		const c = { ...DEFAULT_TERRAIN_CONFIG, hydrologySourcesPerTile: 1 }
		expect(isSpring({ q: 0, r: 0 }, c.seaLevel - 0.1, 1, c)).toBe(false)
	})

	it('parity mask: (q|r) odd excludes springs', () => {
		const c = { ...DEFAULT_TERRAIN_CONFIG, hydrologySourcesPerTile: 1, hydrologyLandCeiling: 1 }
		expect(isSpring({ q: 1, r: 0 }, 0.5, 99, c)).toBe(false)
		expect(isSpring({ q: 0, r: 0 }, 0.5, 99, c)).toBe(true)
	})
})

describe('runHydrology()', () => {
	it('flat land produces no edges', () => {
		const tiles = new Map<string, TileField>()
		for (const coord of axial.enum(2)) {
			tiles.set(axial.key(coord), baseTile({ height: 0.05 }))
		}
		const edges = runHydrology(tiles, 1, DEFAULT_TERRAIN_CONFIG)
		expect(edges.size).toBe(0)
	})

	it('trace from high center to ocean neighbor creates edge flux', () => {
		const cfg = {
			...DEFAULT_TERRAIN_CONFIG,
			hydrologyMaxTraceSteps: 16,
			hydrologyFluxStepWeight: 6,
		}
		const tiles = new Map<string, TileField>()
		tiles.set('0,0', baseTile({ height: 0.25 }))
		const ocean: AxialCoord = { q: -1, r: 0 }
		for (const n of axial.neighbors({ q: 0, r: 0 })) {
			const k = axial.key(n)
			if (n.q === ocean.q && n.r === ocean.r) {
				tiles.set(k, baseTile({ height: cfg.seaLevel - 0.08 }))
			} else {
				tiles.set(k, baseTile({ height: 0.12 }))
			}
		}

		const edges = runHydrology(tiles, 123, {
			...cfg,
			hydrologySourcesPerTile: 1,
			hydrologyLandCeiling: 0.3,
		})

		expect(edges.size).toBeGreaterThan(0)
		const totalFlux = [...edges.values()].reduce((s, e) => s + e.flux, 0)
		expect(totalFlux).toBeGreaterThan(0)
		for (const e of edges.values()) {
			expect(e.width).toBeGreaterThan(0)
			expect(e.depth).toBeGreaterThanOrEqual(0)
		}
	})

	it('path search can route around a shallow local trap to reach the sea', () => {
		const cfg = {
			...DEFAULT_TERRAIN_CONFIG,
			hydrologySourcesPerTile: 1,
			hydrologyLandCeiling: 0.3,
			hydrologyMaxTraceSteps: 8,
			hydrologyFluxStepWeight: 6,
		}
		const tiles = new Map<string, TileField>()
		tiles.set('0,0', baseTile({ height: 0.24 }))
		tiles.set('-1,0', baseTile({ height: 0.18 }))
		tiles.set('-2,0', baseTile({ height: 0.2 }))
		tiles.set('-3,0', baseTile({ height: 0.22 }))
		tiles.set('1,0', baseTile({ height: 0.23 }))
		tiles.set('2,0', baseTile({ height: 0.16 }))
		tiles.set('3,0', baseTile({ height: cfg.seaLevel - 0.04 }))
		tiles.set('0,1', baseTile({ height: 0.22 }))
		tiles.set('1,-1', baseTile({ height: 0.21 }))
		tiles.set('2,-1', baseTile({ height: 0.18 }))
		tiles.set('3,-1', baseTile({ height: 0.14 }))

		const hydrology = runHydrologyDetailed(tiles, 17, cfg)
		expect(hydrology.edges.size).toBeGreaterThan(0)
		expect(hydrology.edges.has('0,0-1,0')).toBe(true)
		expect(hydrology.edges.has('1,0-2,0')).toBe(true)
		expect(hydrology.edges.has('2,0-3,0')).toBe(true)
		expect(hydrology.banks.get('0,1') ?? 0).toBeGreaterThan(0)
		expect(hydrology.channelInfluence.get('1,0') ?? 0).toBeGreaterThan(0)
		expect(hydrology.banks.get('1,-1') ?? 0).toBeGreaterThan(0)
	})
})

describe('generate() hydrology', () => {
	it('large boards often have river edges', () => {
		const snap = generate(42, 12)
		let maxFlux = 0
		for (const e of snap.edges.values()) maxFlux = Math.max(maxFlux, e.flux)
		expect(maxFlux).toBeGreaterThan(5)
	})

	it('deterministic edges for same seed and boardSize', () => {
		const a = generate(7, 8)
		const b = generate(7, 8)
		expect(a.edges.size).toBe(b.edges.size)
		for (const [k, ea] of a.edges) {
			expect(b.edges.get(k)?.flux).toBe(ea.flux)
		}
	})
})
