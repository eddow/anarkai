import { describe, expect, it } from 'vitest'
import {
	DEFAULT_SECTOR_HYDROLOGY_PADDING,
	generate,
	generateAsync,
	generateHydratedRegion,
	generateHydratedRegionAsync,
	generateSectorRegionAsync,
	generateSectorRegionAsyncWithMetrics,
} from '../src/generate'

describe('generate()', () => {
	it('produces correct tile count for hex board', () => {
		const snap = generate(42, 10)
		expect(snap.tiles.size).toBeGreaterThan(0)
		expect(snap.tiles.size).toBe(snap.biomes.size)
		for (const [key, biome] of snap.biomes) {
			expect(snap.tiles.has(key)).toBe(true)
			expect([
				'ocean',
				'lake',
				'sand',
				'grass',
				'forest',
				'rocky',
				'snow',
				'wetland',
				'river-bank',
			]).toContain(biome)
		}
	})

	it('is deterministic: same seed + boardSize -> identical snapshot', () => {
		const a = generate(42, 10)
		const b = generate(42, 10)
		expect(a.tiles.size).toBe(b.tiles.size)
		for (const [key, tile] of a.tiles) {
			expect(b.tiles.get(key)?.height).toBe(tile.height)
		}
	})

	it('different seeds produce different terrain', () => {
		const a = generate(42, 10)
		const b = generate(99, 10)
		let differences = 0
		for (const [key] of a.tiles) {
			if (b.tiles.get(key)?.height !== a.tiles.get(key)?.height) differences++
		}
		expect(differences).toBeGreaterThan(a.tiles.size / 2)
	})

	it('generateAsync() matches sync full-board generation', async () => {
		const sync = generate(42, 10)
		const asyncSnap = await generateAsync(42, 10)
		expect(asyncSnap.tiles.size).toBe(sync.tiles.size)
	})

	it('hydrated region generation currently emits empty hydrology', async () => {
		const coords = [
			{ q: 0, r: 0 },
			{ q: 1, r: 0 },
			{ q: 0, r: 1 },
		]
		const sync = generateHydratedRegion(42, coords)
		const asyncSnap = await generateHydratedRegionAsync(42, coords)

		for (const snap of [sync, asyncSnap]) {
			expect(snap.tiles.size).toBe(coords.length)
			expect(snap.edges.size).toBe(0)
			expect(snap.hydrology.banks.size).toBe(0)
			expect(snap.hydrology.channels.size).toBe(0)
			expect(snap.hydrology.channelInfluence.size).toBe(0)
		}
	})

	it('generates a sector batch through WASM with deterministic negative coordinates', async () => {
		const snap = await generateSectorRegionAsync(42, [{ q: -1, r: 1 }], {
			sectorStep: 17,
			padding: 0,
		})

		expect(snap.tiles.size).toBe(17 * 17)
		expect(snap.tiles.has('-17,17')).toBe(true)
		expect(snap.tiles.has('-1,33')).toBe(true)
		expect(snap.edges.size).toBe(0)
		expect(snap.hydrology.channels.size).toBe(0)
	})

	it('unpacks WASM sector hydrology into edges and channel flow', async () => {
		const snap = await generateSectorRegionAsync(1, [{ q: 0, r: 0 }], {
			sectorStep: 17,
			padding: 1,
			hydrologyPadding: 16,
		})

		expect(snap.edges.size).toBeGreaterThan(0)
		expect(snap.hydrology.channels.size).toBeGreaterThan(0)
		expect(snap.hydrology.channelInfluence.size).toBe(snap.hydrology.channels.size)
		expect(snap.hydrology.riverFlow?.size ?? 0).toBe(snap.hydrology.channels.size)
		for (const key of snap.hydrology.channels) {
			expect(snap.tiles.has(key)).toBe(true)
		}
	})

	it('uses the live sector hydrology padding by default', async () => {
		const { metrics } = await generateSectorRegionAsyncWithMetrics(1, [{ q: 0, r: 0 }], {
			sectorStep: 17,
			padding: 1,
		})

		expect(metrics.hydrologyPadding).toBe(DEFAULT_SECTOR_HYDROLOGY_PADDING)
		expect(metrics.paddedTileCount).toBeGreaterThan(metrics.emittedTileCount)
	})

	it('can generate sector fields without detail hydrology', async () => {
		const { snapshot, metrics } = await generateSectorRegionAsyncWithMetrics(1, [{ q: 0, r: 0 }], {
			sectorStep: 17,
			padding: 1,
			includeHydrology: false,
		})

		expect(snapshot.tiles.size).toBeGreaterThan(0)
		expect(snapshot.edges.size).toBe(0)
		expect(snapshot.hydrology.channels.size).toBe(0)
		expect(metrics.hydrologyPadding).toBe(0)
	})
})
