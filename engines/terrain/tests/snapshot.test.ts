import {
	applyTileOverrides,
	createSnapshot,
	generate,
	generateAsync,
	generateHydratedRegion,
	generateHydratedRegionAsync,
	generateHydratedRegionAsyncWithMetrics,
	generateHydratedRegionWithMetrics,
	generateRegion,
	generateRegionAsync,
	generateTile,
	hexTiles,
	mergeSnapshotRegion,
	populateSnapshot,
	populateSnapshotAsync,
	pruneSnapshot,
	type TerrainSnapshot,
} from 'terrain/index'
import { describe, expect, it } from 'vitest'

describe('generate()', () => {
	it('is deterministic: same seed + boardSize -> identical snapshot', () => {
		const a = generate(42, 5)
		const b = generate(42, 5)

		expect(a.tiles.size).toBe(b.tiles.size)
		for (const [key, tileA] of a.tiles) {
			const tileB = b.tiles.get(key)
			expect(tileB).toBeDefined()
			expect(tileA.height).toBe(tileB!.height)
			expect(tileA.temperature).toBe(tileB!.temperature)
			expect(tileA.humidity).toBe(tileB!.humidity)
		}
	})

	it('different seeds produce different terrain', () => {
		const a = generate(1, 5)
		const b = generate(2, 5)

		let diffs = 0
		for (const [key, tileA] of a.tiles) {
			const tileB = b.tiles.get(key)!
			if (tileA.height !== tileB.height) diffs++
		}
		expect(diffs).toBeGreaterThan(a.tiles.size / 2)
	})

	it('produces correct tile count for hex board', () => {
		for (const size of [1, 3, 5, 8, 12]) {
			const snap = generate(0, size)
			expect(snap.tiles.size).toBe(hexTiles(size))
		}
	})

	it('same coord+seed gives same value regardless of boardSize', () => {
		const small = generate(42, 3)
		const large = generate(42, 12)

		for (const [key, tileSmall] of small.tiles) {
			const tileLarge = large.tiles.get(key)
			expect(tileLarge).toBeDefined()
			expect(tileSmall.height).toBe(tileLarge!.height)
			expect(tileSmall.temperature).toBe(tileLarge!.temperature)
			expect(tileSmall.humidity).toBe(tileLarge!.humidity)
		}
	})

	it('edge fields are positive when hydrology traces exist', () => {
		const snap = generate(42, 10)
		for (const e of snap.edges.values()) {
			expect(e.flux).toBeGreaterThan(0)
			expect(e.width).toBeGreaterThan(0)
		}
	})

	it('biomes map has same keys as tiles', () => {
		const snap = generate(7, 6)
		expect(snap.biomes.size).toBe(snap.tiles.size)
		for (const key of snap.tiles.keys()) {
			expect(snap.biomes.has(key)).toBe(true)
		}
	})

	it('generateAsync() matches sync full-board generation', async () => {
		const sync = generate(42, 6, { fieldBackend: 'cpu' })
		const asyncSnap = await generateAsync(42, 6, { fieldBackend: 'auto' })

		expect(asyncSnap.tiles.size).toBe(sync.tiles.size)
		expect(asyncSnap.biomes.size).toBe(sync.biomes.size)
		expect(asyncSnap.edges.size).toBe(sync.edges.size)
		for (const [key, tile] of sync.tiles) {
			expect(asyncSnap.tiles.get(key)?.height).toBeCloseTo(tile.height, 5)
			expect(asyncSnap.tiles.get(key)?.temperature).toBeCloseTo(tile.temperature, 5)
			expect(asyncSnap.tiles.get(key)?.humidity).toBeCloseTo(tile.humidity, 5)
			expect(asyncSnap.biomes.get(key)).toBe(sync.biomes.get(key))
		}
	})
})

describe('generateTile()', () => {
	it('matches batch tile fields; biome omits hydrology', () => {
		const snap = generate(42, 5)
		const coord = { q: 2, r: -1 }
		const key = `2,-1`
		const { tile } = generateTile(42, coord)

		expect(tile.height).toBe(snap.tiles.get(key)!.height)
		expect(tile.temperature).toBe(snap.tiles.get(key)!.temperature)
		expect(tile.humidity).toBe(snap.tiles.get(key)!.humidity)
	})
})

describe('incremental snapshots', () => {
	it('createSnapshot() initializes an empty snapshot', () => {
		const snap = createSnapshot(42)
		expect(snap.seed).toBe(42)
		expect(snap.tiles.size).toBe(0)
		expect(snap.edges.size).toBe(0)
		expect(snap.biomes.size).toBe(0)
	})

	it('populateSnapshot() adds only missing coords and returns added keys', () => {
		const snap = createSnapshot(42)
		const coords = [
			{ q: 0, r: 0 },
			{ q: 1, r: 0 },
			{ q: 0, r: 1 },
		]

		const first = populateSnapshot(snap, coords)
		expect(first.added.length).toBe(3)
		expect(snap.tiles.size).toBe(3)
		expect(snap.biomes.size).toBe(3)
		expect(snap.edges.size).toBe(0)

		const second = populateSnapshot(snap, coords)
		expect(second.added.length).toBe(0)
		expect(snap.tiles.size).toBe(3)
		expect(snap.biomes.size).toBe(3)
	})

	it('supports incremental batches and keeps deterministic field values', () => {
		const snap = createSnapshot(42)
		const firstBatch = [
			{ q: 0, r: 0 },
			{ q: 1, r: 0 },
		]
		const secondBatch = [
			{ q: 0, r: 1 },
			{ q: 2, r: -1 },
		]

		populateSnapshot(snap, firstBatch)
		populateSnapshot(snap, secondBatch)

		const region = generateRegion(42, [...firstBatch, ...secondBatch])
		expect(snap.tiles.size).toBe(region.tiles.size)
		for (const [key, tile] of snap.tiles) {
			expect(region.tiles.get(key)?.height).toBe(tile.height)
			expect(region.tiles.get(key)?.temperature).toBe(tile.temperature)
			expect(region.tiles.get(key)?.humidity).toBe(tile.humidity)
		}
	})

	it('matches full-board field values for overlapping coords', () => {
		const full = generate(42, 5)
		const coords = [
			{ q: 0, r: 0 },
			{ q: 1, r: -1 },
			{ q: -2, r: 1 },
		]
		const partial = generateRegion(42, coords)

		for (const coord of coords) {
			const key = `${coord.q},${coord.r}`
			expect(partial.tiles.get(key)?.height).toBe(full.tiles.get(key)?.height)
			expect(partial.tiles.get(key)?.temperature).toBe(full.tiles.get(key)?.temperature)
			expect(partial.tiles.get(key)?.humidity).toBe(full.tiles.get(key)?.humidity)
		}
	})

	it('rejects invalid snapshots', () => {
		const invalid = {
			seed: Number.NaN,
			tiles: new Map(),
			edges: new Map(),
			biomes: new Map(),
		} as unknown as TerrainSnapshot

		expect(() => populateSnapshot(invalid, [{ q: 0, r: 0 }])).toThrow(/Invalid TerrainSnapshot/)
	})

	it('applyTileOverrides() patches tile fields and biome', () => {
		const snap = createSnapshot(42)
		populateSnapshot(snap, [{ q: 0, r: 0 }])
		const before = snap.tiles.get('0,0')!

		applyTileOverrides(snap, [
			{
				coord: { q: 0, r: 0 },
				tile: { height: before.height + 0.5 },
				biome: 'snow',
			},
		])

		expect(snap.tiles.get('0,0')!.height).toBeCloseTo(before.height + 0.5)
		expect(snap.biomes.get('0,0')).toBe('snow')
	})

	it('generateRegion() applies tileOverrides while leaving other coords generated', () => {
		const coords = [
			{ q: 0, r: 0 },
			{ q: 1, r: 0 },
		]
		const base = generateRegion(42, coords)
		const overridden = generateRegion(42, coords, {
			tileOverrides: [
				{
					coord: { q: 0, r: 0 },
					tile: { height: 0.9 },
					biome: 'rocky',
				},
			],
		})

		expect(overridden.tiles.get('0,0')!.height).toBe(0.9)
		expect(overridden.biomes.get('0,0')).toBe('rocky')
		expect(overridden.tiles.get('1,0')!.height).toBe(base.tiles.get('1,0')!.height)
	})

	it('generate() applies tileOverrides for full-board snapshots', () => {
		const overridden = generate(42, 5, {
			tileOverrides: [
				{
					coord: { q: 0, r: 0 },
					tile: { height: 1.0 },
					biome: 'snow',
				},
			],
		})

		expect(overridden.tiles.get('0,0')!.height).toBe(1.0)
		expect(overridden.biomes.get('0,0')).toBe('snow')
	})

	it('field backend seam keeps deterministic output when gpu is requested', () => {
		const cpu = generateRegion(42, [{ q: 0, r: 0 }, { q: 1, r: 0 }], { fieldBackend: 'cpu' })
		const gpu = generateRegion(42, [{ q: 0, r: 0 }, { q: 1, r: 0 }], { fieldBackend: 'gpu' })

		for (const [key, tile] of cpu.tiles) {
			expect(gpu.tiles.get(key)?.height).toBe(tile.height)
			expect(gpu.tiles.get(key)?.temperature).toBe(tile.temperature)
			expect(gpu.tiles.get(key)?.humidity).toBe(tile.humidity)
		}
	})

	it('async snapshot generation stays parity-safe with the sync cpu path', async () => {
		const coords = [
			{ q: 0, r: 0 },
			{ q: 1, r: 0 },
			{ q: -2, r: 3 },
		]
		const sync = generateRegion(42, coords, { fieldBackend: 'cpu' })
		const asyncRegion = await generateRegionAsync(42, coords, { fieldBackend: 'auto' })
		const asyncSnapshot = createSnapshot(42)
		await populateSnapshotAsync(asyncSnapshot, coords, { fieldBackend: 'auto' })

		for (const [key, tile] of sync.tiles) {
			expect(asyncRegion.tiles.get(key)?.height).toBeCloseTo(tile.height, 5)
			expect(asyncRegion.tiles.get(key)?.temperature).toBeCloseTo(tile.temperature, 5)
			expect(asyncRegion.tiles.get(key)?.humidity).toBeCloseTo(tile.humidity, 5)
			expect(asyncSnapshot.tiles.get(key)?.height).toBeCloseTo(tile.height, 5)
			expect(asyncSnapshot.tiles.get(key)?.temperature).toBeCloseTo(tile.temperature, 5)
			expect(asyncSnapshot.tiles.get(key)?.humidity).toBeCloseTo(tile.humidity, 5)
		}
	})

	it('generateHydratedRegion() clips to requested coords while keeping hydrated edges', () => {
		const coords = [
			{ q: 0, r: 0 },
			{ q: 1, r: 0 },
			{ q: 0, r: 1 },
		]
		const hydrated = generateHydratedRegion(42, coords, { hydrologyPadding: 4 })

		expect(hydrated.tiles.size).toBe(coords.length)
		for (const coord of coords) {
			expect(hydrated.tiles.has(`${coord.q},${coord.r}`)).toBe(true)
			expect(hydrated.biomes.has(`${coord.q},${coord.r}`)).toBe(true)
		}
		for (const edgeKey of hydrated.edges.keys()) {
			const [a, b] = edgeKey.split('-')
			expect(
				coords.some((coord) => `${coord.q},${coord.r}` === a || `${coord.q},${coord.r}` === b)
			).toBe(true)
		}
	})

	it('keeps border-touching edges even when the requested tile is the second endpoint', () => {
		const candidate = [
			{ seed: 42, size: 12 },
			{ seed: 100, size: 12 },
			{ seed: 999, size: 12 },
		]
			.map(({ seed, size }) => {
				const full = generate(seed, size)
				return [...full.edges.keys()].find((key) => {
					const requestedKey = key.split('-')[1]!
					const [q, r] = requestedKey.split(',').map(Number)
					const clipped = generateHydratedRegion(seed, [{ q, r }], { hydrologyPadding: 4 })
					return clipped.edges.has(key)
				})
			})
			.find((value) => value !== undefined)

		expect(candidate).toBeDefined()
	})

	it('generateHydratedRegionAsync() stays parity-safe with sync hydrated regions', async () => {
		const coords = [
			{ q: 0, r: 0 },
			{ q: 1, r: 0 },
			{ q: -1, r: 1 },
			{ q: 2, r: -1 },
		]
		const sync = generateHydratedRegion(42, coords, {
			fieldBackend: 'cpu',
			hydrologyPadding: 4,
		})
		const asyncSnap = await generateHydratedRegionAsync(42, coords, {
			fieldBackend: 'auto',
			hydrologyPadding: 4,
		})

		expect(asyncSnap.tiles.size).toBe(sync.tiles.size)
		for (const [key, tile] of sync.tiles) {
			expect(asyncSnap.tiles.get(key)?.height).toBeCloseTo(tile.height, 5)
			expect(asyncSnap.tiles.get(key)?.temperature).toBeCloseTo(tile.temperature, 5)
			expect(asyncSnap.tiles.get(key)?.humidity).toBeCloseTo(tile.humidity, 5)
			expect(asyncSnap.biomes.get(key)).toBe(sync.biomes.get(key))
		}
	})

	it('reports async hydrated-region metrics for amplification and timing analysis', async () => {
		const coords = [
			{ q: 0, r: 0 },
			{ q: 1, r: 0 },
			{ q: -1, r: 1 },
			{ q: 2, r: -1 },
		]
		const { snapshot, metrics } = await generateHydratedRegionAsyncWithMetrics(42, coords, {
			hydrologyPadding: 4,
		})

		expect(snapshot.tiles.size).toBe(coords.length)
		expect(metrics.requestedTileCount).toBe(coords.length)
		expect(metrics.emittedTileCount).toBe(snapshot.tiles.size)
		expect(metrics.paddedTileCount).toBeGreaterThan(metrics.requestedTileCount)
		expect(metrics.paddingAmplification).toBeGreaterThan(1)
		expect(metrics.emittedEdgeCount).toBe(snapshot.edges.size)
		expect(metrics.timings.totalMs).toBeGreaterThanOrEqual(metrics.timings.fieldGenerationMs)
		expect(metrics.timings.totalMs).toBeGreaterThanOrEqual(metrics.timings.hydrologyMs)
		expect(metrics.timings.totalMs).toBeGreaterThanOrEqual(metrics.timings.clippingMs)
	})

	it('reports hydrated-region metrics for amplification and timing analysis', () => {
		const coords = [
			{ q: 0, r: 0 },
			{ q: 1, r: 0 },
			{ q: -1, r: 1 },
			{ q: 2, r: -1 },
		]
		const { snapshot, metrics } = generateHydratedRegionWithMetrics(42, coords, {
			hydrologyPadding: 4,
		})

		expect(snapshot.tiles.size).toBe(coords.length)
		expect(metrics.requestedTileCount).toBe(coords.length)
		expect(metrics.emittedTileCount).toBe(snapshot.tiles.size)
		expect(metrics.paddedTileCount).toBeGreaterThan(metrics.requestedTileCount)
		expect(metrics.paddingAmplification).toBeGreaterThan(1)
		expect(metrics.emittedEdgeCount).toBe(snapshot.edges.size)
		expect(metrics.edgePerRequestedTile).toBeGreaterThanOrEqual(0)
		expect(metrics.timings.fieldGenerationMs).toBeGreaterThanOrEqual(0)
		expect(metrics.timings.hydrologyMs).toBeGreaterThanOrEqual(0)
		expect(metrics.timings.clippingMs).toBeGreaterThanOrEqual(0)
		expect(metrics.timings.totalMs).toBeGreaterThanOrEqual(metrics.timings.fieldGenerationMs)
		expect(metrics.timings.totalMs).toBeGreaterThanOrEqual(metrics.timings.hydrologyMs)
		expect(metrics.timings.totalMs).toBeGreaterThanOrEqual(metrics.timings.clippingMs)
	})

	it('adjacent hydrated regions use deterministic edge ownership', () => {
		const leftCoords = [
			{ q: 0, r: 0 },
			{ q: 1, r: 0 },
			{ q: 0, r: 1 },
		]
		const rightCoords = [
			{ q: 2, r: 0 },
			{ q: 2, r: -1 },
			{ q: 1, r: 1 },
		]
		const left = generateHydratedRegion(42, leftCoords, { hydrologyPadding: 4 })
		const right = generateHydratedRegion(42, rightCoords, { hydrologyPadding: 4 })
		const combined = generateHydratedRegion(42, [...leftCoords, ...rightCoords], {
			hydrologyPadding: 4,
		})

		const unionEdges = new Map([...left.edges, ...right.edges])
		expect([...unionEdges.keys()].sort()).toEqual([...combined.edges.keys()].sort())
		for (const [key, edge] of unionEdges) {
			const combinedEdge = combined.edges.get(key)
			expect(combinedEdge?.flux).toBe(edge.flux)
			expect(combinedEdge?.width).toBe(edge.width)
		}
	})

	it('can merge hydrated regions into a long-lived snapshot', () => {
		const snapshot = createSnapshot(42)
		const leftCoords = [
			{ q: 0, r: 0 },
			{ q: 1, r: 0 },
			{ q: 0, r: 1 },
		]
		const rightCoords = [
			{ q: 2, r: 0 },
			{ q: 2, r: -1 },
			{ q: 1, r: 1 },
		]
		const left = generateHydratedRegion(42, leftCoords, { hydrologyPadding: 4 })
		const right = generateHydratedRegion(42, rightCoords, { hydrologyPadding: 4 })
		const combined = generateHydratedRegion(42, [...leftCoords, ...rightCoords], {
			hydrologyPadding: 4,
		})

		expect(mergeSnapshotRegion(snapshot, left).addedTiles.sort()).toEqual(
			['0,0', '0,1', '1,0'].sort()
		)
		expect(mergeSnapshotRegion(snapshot, right).addedTiles.sort()).toEqual(
			['1,1', '2,-1', '2,0'].sort()
		)
		expect([...snapshot.tiles.keys()].sort()).toEqual([...combined.tiles.keys()].sort())
		expect([...snapshot.edges.keys()].sort()).toEqual([...combined.edges.keys()].sort())
	})

	it('keeps overlapping hydrated tiles stable while merging pan-like region requests', () => {
		const snapshot = createSnapshot(42)
		const firstWindow = [
			{ q: -2, r: 0 },
			{ q: -1, r: 0 },
			{ q: 0, r: 0 },
			{ q: -2, r: 1 },
			{ q: -1, r: 1 },
			{ q: 0, r: 1 },
		]
		const secondWindow = [
			{ q: -1, r: 0 },
			{ q: 0, r: 0 },
			{ q: 1, r: 0 },
			{ q: -1, r: 1 },
			{ q: 0, r: 1 },
			{ q: 1, r: 1 },
		]
		const overlap = firstWindow.filter((coord) =>
			secondWindow.some((candidate) => candidate.q === coord.q && candidate.r === coord.r)
		)

		const first = generateHydratedRegion(42, firstWindow, { hydrologyPadding: 4 })
		mergeSnapshotRegion(snapshot, first)
		const beforeMerge = new Map(
			overlap.map((coord) => {
				const key = `${coord.q},${coord.r}`
				return [
					key,
					{
						tile: snapshot.tiles.get(key),
						biome: snapshot.biomes.get(key),
					},
				]
			})
		)

		const second = generateHydratedRegion(42, secondWindow, { hydrologyPadding: 4 })
		mergeSnapshotRegion(snapshot, second)
		const union = generateHydratedRegion(42, [...firstWindow, ...secondWindow], { hydrologyPadding: 4 })

		for (const coord of overlap) {
			const key = `${coord.q},${coord.r}`
			const previous = beforeMerge.get(key)
			const mergedTile = snapshot.tiles.get(key)
			const unionTile = union.tiles.get(key)
			expect(previous).toBeDefined()
			expect(mergedTile).toBeDefined()
			expect(unionTile).toBeDefined()
			expect(mergedTile?.height).toBe(previous?.tile?.height)
			expect(mergedTile?.temperature).toBe(previous?.tile?.temperature)
			expect(mergedTile?.humidity).toBe(previous?.tile?.humidity)
			expect(snapshot.biomes.get(key)).toBe(previous?.biome)
			expect(mergedTile?.height).toBe(unionTile?.height)
			expect(mergedTile?.temperature).toBe(unionTile?.temperature)
			expect(mergedTile?.humidity).toBe(unionTile?.humidity)
			expect(snapshot.biomes.get(key)).toBe(union.biomes.get(key))
		}
	})

	it('matches union generation when hydrated requests are split into multiple visible batches', () => {
		const snapshot = createSnapshot(77)
		const leftBatch = [
			{ q: -1, r: -1 },
			{ q: 0, r: -1 },
			{ q: -1, r: 0 },
			{ q: 0, r: 0 },
		]
		const rightBatch = [
			{ q: 1, r: -1 },
			{ q: 2, r: -1 },
			{ q: 1, r: 0 },
			{ q: 2, r: 0 },
		]
		const bridgeBatch = [
			{ q: 0, r: -1 },
			{ q: 1, r: -1 },
			{ q: 0, r: 0 },
			{ q: 1, r: 0 },
		]

		for (const batch of [leftBatch, rightBatch, bridgeBatch]) {
			mergeSnapshotRegion(snapshot, generateHydratedRegion(77, batch, { hydrologyPadding: 4 }))
		}

		const unionCoords = [...leftBatch, ...rightBatch, ...bridgeBatch]
		const union = generateHydratedRegion(77, unionCoords, { hydrologyPadding: 4 })

		expect([...snapshot.tiles.keys()].sort()).toEqual([...union.tiles.keys()].sort())
		expect([...snapshot.biomes.keys()].sort()).toEqual([...union.biomes.keys()].sort())
		expect([...snapshot.edges.keys()].sort()).toEqual([...union.edges.keys()].sort())

		for (const [key, tile] of union.tiles) {
			expect(snapshot.tiles.get(key)?.height).toBe(tile.height)
			expect(snapshot.tiles.get(key)?.temperature).toBe(tile.temperature)
			expect(snapshot.tiles.get(key)?.humidity).toBe(tile.humidity)
			expect(snapshot.biomes.get(key)).toBe(union.biomes.get(key))
		}

		for (const [key, edge] of union.edges) {
			expect(snapshot.edges.get(key)?.flux).toBe(edge.flux)
			expect(snapshot.edges.get(key)?.width).toBe(edge.width)
			expect(snapshot.edges.get(key)?.depth).toBe(edge.depth)
		}
	})

	it('can prune a long-lived snapshot to retained coords', () => {
		const snapshot = createSnapshot(42)
		const coords = [
			{ q: 0, r: 0 },
			{ q: 1, r: 0 },
			{ q: 0, r: 1 },
			{ q: 2, r: 0 },
		]
		const hydrated = generateHydratedRegion(42, coords, { hydrologyPadding: 4 })
		mergeSnapshotRegion(snapshot, hydrated)

		const result = pruneSnapshot(snapshot, [
			{ q: 0, r: 0 },
			{ q: 1, r: 0 },
		])

		expect(result.removedTiles.sort()).toEqual(['0,1', '2,0'].sort())
		expect([...snapshot.tiles.keys()].sort()).toEqual(['0,0', '1,0'])
		for (const key of snapshot.edges.keys()) {
			const [a, b] = key.split('-')
			expect(a === '0,0' || a === '1,0' || b === '0,0' || b === '1,0').toBe(true)
		}
	})
})
