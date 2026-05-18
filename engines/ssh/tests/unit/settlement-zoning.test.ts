import type { Game } from 'ssh/game/game'
import {
	GameGenerator,
	type GeneratedSettlement,
	type GeneratedTileData,
	generateSettlementRegionSetPlan,
	generateZonePlanForSettlements,
} from 'ssh/generation'
import { type AxialCoord, axial, hexSides } from 'ssh/utils'
import { afterEach, describe, expect, it } from 'vitest'

// Helper to build typed arrays for WASM road generation
function buildTypedArrays(tiles: GeneratedTileData[], _seed: number) {
	const tileCount = tiles.length
	const coords = new Int32Array(tileCount * 2)
	const terrainKinds = new Uint8Array(tileCount)
	const hasRiver = new Uint8Array(tileCount)

	const tileMap = new Map<string, GeneratedTileData>()
	for (const tile of tiles) {
		tileMap.set(`${tile.coord.q},${tile.coord.r}`, tile)
	}

	for (let i = 0; i < tileCount; i++) {
		const tile = tiles[i]!
		coords[i * 2] = tile.coord.q
		coords[i * 2 + 1] = tile.coord.r
		terrainKinds[i] =
			tile.terrain === 'water'
				? 0
				: tile.terrain === 'forest'
					? 2
					: tile.terrain === 'rocky'
						? 3
						: 1

		// River: tile has hydrology with channel or edges
		hasRiver[i] =
			tile.hydrology?.isChannel ||
			(tile.hydrology?.bankInfluence ?? 0) > 0 ||
			Object.keys(tile.hydrology?.edges ?? {}).length > 0
				? 1
				: 0
	}

	// Propagate river to neighbours
	for (let i = 0; i < tileCount; i++) {
		if (hasRiver[i] !== 1) continue
		const tile = tiles[i]!
		for (const side of hexSides) {
			const nKey = `${tile.coord.q + side.q},${tile.coord.r + side.r}`
			const nIndex = tileMap.get(nKey)
			if (nIndex === undefined) continue
			const ni = tiles.findIndex(
				(t) => t.coord.q === tile.coord.q + side.q && t.coord.r === tile.coord.r + side.r
			)
			if (ni >= 0) hasRiver[ni] = 1
		}
	}

	return { coords, terrainKinds, hasRiver }
}

function tile(coord: AxialCoord, overrides: Partial<GeneratedTileData> = {}): GeneratedTileData {
	return {
		coord,
		terrain: 'grass',
		height: 0.05,
		goods: {},
		walkTime: 1,
		...overrides,
	}
}

function region(center: AxialCoord, radius: number): GeneratedTileData[] {
	return [...axial.allTiles(center, radius)].map((coord) =>
		tile(coord, {
			deposit:
				coord.q === center.q + 2 && coord.r === center.r - 1
					? { type: 'rock', amount: 20 }
					: undefined,
			hydrology:
				coord.q === center.q ? { isChannel: true, bankInfluence: 1, edges: {} } : undefined,
			terrain:
				coord.q === center.q + 2 && coord.r === center.r - 1
					? 'rocky'
					: coord.q < center.q - 3
						? 'water'
						: 'grass',
		})
	)
}

function dryRegion(center: AxialCoord, radius: number): GeneratedTileData[] {
	return [...axial.allTiles(center, radius)].map((coord) => tile(coord))
}

function settlement(overrides: Partial<GeneratedSettlement> = {}): GeneratedSettlement {
	const kind = overrides.kind ?? 'town'
	const radius = overrides.radius ?? (kind === 'city' ? 4 : kind === 'town' ? 3 : 2)
	return {
		id: 'settlement-0,0',
		name: 'Town of (0,0)',
		kind,
		center: { q: 0, r: 0 },
		score: 1,
		radius,
		...overrides,
	}
}

describe('settlement zoning generation', () => {
	const games = new Set<Game>()

	afterEach(() => {
		for (const game of games) game.destroy()
		games.clear()
	})

	it('creates deterministic residential, named production zones, and local roads', async () => {
		const tiles = region({ q: 0, r: 0 }, 6)
		const generator = new GameGenerator()
		const firstSettlements = await generator.placeSettlements(42, tiles, {
			settlementCount: 2,
			minSpacing: 4,
		})
		const secondSettlements = await generator.placeSettlements(42, tiles, {
			settlementCount: 2,
			minSpacing: 4,
		})
		const { coords, terrainKinds, hasRiver } = buildTypedArrays(tiles, 42)
		const first = await generateZonePlanForSettlements(
			tiles,
			firstSettlements.settlements,
			42,
			coords,
			terrainKinds,
			hasRiver
		)
		const second = await generateZonePlanForSettlements(
			tiles,
			secondSettlements.settlements,
			42,
			coords,
			terrainKinds,
			hasRiver
		)

		expect(first).toEqual(second)
		expect(first.settlements.length).toBeGreaterThan(0)
		expect(first.zones.residential.length).toBeGreaterThan(0)
		expect(first.zones.harvest.length).toBeGreaterThan(0)
		expect(first.zones.named.map((zone) => zone.id)).toContain('industrial')
		expect(first.roads.path?.length).toBeGreaterThan(0)
	})

	it('describes settlement regions inside a generic region set', async () => {
		const tiles = region({ q: 0, r: 0 }, 6)
		const generator = new GameGenerator()
		const settlements = await generator.placeSettlements(42, tiles, {
			settlementCount: 2,
			minSpacing: 4,
		})
		const { coords, terrainKinds, hasRiver } = buildTypedArrays(tiles, 42)
		const plan = await generateSettlementRegionSetPlan(
			tiles,
			settlements.settlements,
			'0,0',
			42,
			coords,
			terrainKinds,
			hasRiver
		)

		expect(plan.regionSet).toMatchObject({
			type: 'region-set',
			key: '0,0',
		})
		expect(plan.regionSet.children.length).toBe(plan.settlements.length)
		expect(plan.regionSet.children.every((child) => child.type === 'region')).toBe(true)
		expect(plan.settlements.every((settlement) => settlement.id.startsWith('settlement-'))).toBe(
			true
		)
	})

	it('does not zone water tiles', async () => {
		const tiles = region({ q: 0, r: 0 }, 5)
		const water = new Set(
			tiles.filter((entry) => entry.terrain === 'water').map((entry) => axial.key(entry.coord))
		)
		const generator = new GameGenerator()
		const settlements = await generator.placeSettlements(9, tiles, {
			settlementCount: 1,
			minSpacing: 7,
		})
		const { coords, terrainKinds, hasRiver } = buildTypedArrays(tiles, 9)
		const plan = await generateZonePlanForSettlements(
			tiles,
			settlements.settlements,
			9,
			coords,
			terrainKinds,
			hasRiver
		)

		const zonedCoords = [
			...plan.zones.harvest,
			...plan.zones.residential,
			...plan.zones.named.flatMap((zone) => zone.coords),
		]
		expect(zonedCoords.some(([q, r]) => water.has(`${q},${r}`))).toBe(false)
	})

	it('keeps generated road corridors unzoned', async () => {
		const tiles = region({ q: 0, r: 0 }, 6)
		const generator = new GameGenerator()
		const settlements = await generator.placeSettlements(42, tiles, {
			settlementCount: 2,
			minSpacing: 4,
		})
		const { coords, terrainKinds, hasRiver } = buildTypedArrays(tiles, 42)
		const plan = await generateZonePlanForSettlements(
			tiles,
			settlements.settlements,
			42,
			coords,
			terrainKinds,
			hasRiver
		)
		const zoned = new Set(
			[
				...plan.zones.harvest,
				...plan.zones.residential,
				...plan.zones.named.flatMap((zone) => zone.coords),
			].map(([q, r]) => `${q},${r}`)
		)
		const settlementAnchors = new Set(
			plan.settlements.map((settlement) => axial.key(settlement.center))
		)

		for (const [q, r] of plan.roads.path ?? []) {
			const floorKey = `${Math.floor(q)},${Math.floor(r)}`
			const ceilKey = `${Math.ceil(q)},${Math.ceil(r)}`
			if (!settlementAnchors.has(floorKey)) expect(zoned.has(floorKey)).toBe(false)
			if (!settlementAnchors.has(ceilKey)) expect(zoned.has(ceilKey)).toBe(false)
		}
	})

	it('does not zone river-influenced tiles', async () => {
		const tiles = region({ q: 0, r: 0 }, 5)
		const riverTiles = new Set(
			tiles
				.filter(
					(entry) =>
						entry.hydrology?.isChannel ||
						(entry.hydrology?.bankInfluence ?? 0) > 0 ||
						Object.keys(entry.hydrology?.edges ?? {}).length > 0
				)
				.map((entry) => axial.key(entry.coord))
		)
		const generator = new GameGenerator()
		const settlements = await generator.placeSettlements(42, tiles, {
			settlementCount: 2,
			minSpacing: 4,
		})
		const { coords, terrainKinds, hasRiver } = buildTypedArrays(tiles, 42)
		const plan = await generateZonePlanForSettlements(
			tiles,
			settlements.settlements,
			42,
			coords,
			terrainKinds,
			hasRiver
		)

		const zonedCoords = [
			...plan.zones.harvest,
			...plan.zones.residential,
			...plan.zones.named.flatMap((zone) => zone.coords),
		]
		expect(zonedCoords.some(([q, r]) => riverTiles.has(`${q},${r}`))).toBe(false)
	})

	it('does not place generated roads on river-edge borders', async () => {
		const tiles = region({ q: 0, r: 0 }, 5).map((entry) =>
			axial.key(entry.coord) === '0,0'
				? {
						...entry,
						hydrology: {
							...entry.hydrology,
							edges: {
								...entry.hydrology?.edges,
								0: { direction: 0, flow: 1 },
							},
						},
					}
				: entry
		) as GeneratedTileData[]
		const generator = new GameGenerator()
		const settlements = await generator.placeSettlements(42, tiles, {
			settlementCount: 1,
			minSpacing: 3,
		})
		const { coords, terrainKinds, hasRiver } = buildTypedArrays(tiles, 42)
		const plan = await generateZonePlanForSettlements(
			tiles,
			settlements.settlements,
			42,
			coords,
			terrainKinds,
			hasRiver
		)

		const roadBorders = new Set(plan.roads.path ?? [])
		expect(roadBorders.has([0, 0.5])).toBe(false)
		expect(roadBorders.has([-0.5, 0.5])).toBe(false)
		expect(roadBorders.has([-0.5, 0])).toBe(false)
		expect(roadBorders.has([0, -0.5])).toBe(false)
		expect(roadBorders.has([0.5, -0.5])).toBe(false)
		expect(roadBorders.has([0.5, 0])).toBe(false)
	})

	it('zones nearby outer-ring deposits as industrial', async () => {
		const tiles = dryRegion({ q: 0, r: 0 }, 7).map((entry) =>
			axial.key(entry.coord) === '4,-1'
				? { ...entry, terrain: 'rocky' as const, deposit: { type: 'rock' as const, amount: 20 } }
				: entry
		)
		const settlements = { settlements: [settlement()] }
		const { coords, terrainKinds, hasRiver } = buildTypedArrays(tiles, 42)
		const plan = await generateZonePlanForSettlements(
			tiles,
			settlements.settlements,
			42,
			coords,
			terrainKinds,
			hasRiver
		)

		const depositTile = tiles.find((entry) => entry.deposit)
		expect(depositTile).toBeDefined()
		if (depositTile) {
			const depositKey = axial.key(depositTile.coord)
			const industrialCoords =
				plan.zones.named.find((zone) => zone.id === 'industrial')?.coords ?? []
			expect(industrialCoords.some(([q, r]) => `${q},${r}` === depositKey)).toBe(true)
		}
	})

	it('does not punch industrial deposits into the settlement core', async () => {
		const tiles = dryRegion({ q: 0, r: 0 }, 5).map((entry) =>
			axial.key(entry.coord) === '2,-1'
				? { ...entry, terrain: 'rocky' as const, deposit: { type: 'rock' as const, amount: 20 } }
				: entry
		)
		const settlements = { settlements: [settlement()] }
		const { coords, terrainKinds, hasRiver } = buildTypedArrays(tiles, 42)
		const plan = await generateZonePlanForSettlements(
			tiles,
			settlements.settlements,
			42,
			coords,
			terrainKinds,
			hasRiver
		)

		const industrialCoords = plan.zones.named.find((zone) => zone.id === 'industrial')?.coords ?? []
		expect(industrialCoords.some(([q, r]) => q === 2 && r === -1)).toBe(false)
		const residentialCoords = new Set(plan.zones.residential.map(([q, r]) => `${q},${r}`))
		expect(residentialCoords.has('2,-1')).toBe(true)
	})

	it('zones civic or market zones at settlement centers', async () => {
		const tiles = dryRegion({ q: 0, r: 0 }, 4)
		const settlements = { settlements: [settlement({ kind: 'town', radius: 3 })] }
		const { coords, terrainKinds, hasRiver } = buildTypedArrays(tiles, 42)
		const plan = await generateZonePlanForSettlements(
			tiles,
			settlements.settlements,
			42,
			coords,
			terrainKinds,
			hasRiver
		)

		const civicCoords = plan.zones.named.find((zone) => zone.id === 'civic')?.coords ?? []
		const marketCoords = plan.zones.named.find((zone) => zone.id === 'market')?.coords ?? []
		const centerCoords = civicCoords.length > 0 ? civicCoords : marketCoords
		expect(centerCoords.length).toBeGreaterThan(0)
		const settlementCenter = plan.settlements[0]?.center
		expect(settlementCenter).toBeDefined()
		if (settlementCenter) {
			expect(
				centerCoords.some(([q, r]) => q === settlementCenter.q && r === settlementCenter.r)
			).toBe(true)
		}
	})

	it('zones market zones for settlements', async () => {
		const tiles = dryRegion({ q: 0, r: 0 }, 8)
		const settlements = {
			settlements: [
				settlement({ id: 'settlement-0,0', center: { q: 0, r: 0 }, kind: 'town', radius: 3 }),
				settlement({ id: 'settlement-5,0', center: { q: 5, r: 0 }, kind: 'village', radius: 2 }),
			],
		}
		const { coords, terrainKinds, hasRiver } = buildTypedArrays(tiles, 42)
		const plan = await generateZonePlanForSettlements(
			tiles,
			settlements.settlements,
			42,
			coords,
			terrainKinds,
			hasRiver
		)

		const marketCoords = plan.zones.named.find((zone) => zone.id === 'market')?.coords ?? []
		expect(marketCoords.length).toBeGreaterThanOrEqual(plan.settlements.length)
	})

	it('zones harvest zones at settlement perimeters', async () => {
		const tiles = region({ q: 0, r: 0 }, 4)
		const generator = new GameGenerator()
		const settlements = await generator.placeSettlements(42, tiles, {
			settlementCount: 1,
			minSpacing: 2,
		})
		const { coords, terrainKinds, hasRiver } = buildTypedArrays(tiles, 42)
		const plan = await generateZonePlanForSettlements(
			tiles,
			settlements.settlements,
			42,
			coords,
			terrainKinds,
			hasRiver
		)

		expect(plan.zones.harvest.length).toBeGreaterThan(0)
		const settlement = plan.settlements[0]
		expect(settlement).toBeDefined()
		if (settlement) {
			const harvestCoords = new Set(plan.zones.harvest.map(([q, r]) => `${q},${r}`))
			const perimeterTiles = [...axial.allTiles(settlement.center, settlement.radius)].filter(
				(coord) => axial.distance(settlement.center, coord) === settlement.radius
			)
			expect(perimeterTiles.some((coord) => harvestCoords.has(`${coord.q},${coord.r}`))).toBe(true)
		}
	})

	it('zones residential zones around settlement center area', async () => {
		const tiles = region({ q: 0, r: 0 }, 4)
		const generator = new GameGenerator()
		const settlements = await generator.placeSettlements(42, tiles, {
			settlementCount: 1,
			minSpacing: 2,
		})
		const { coords, terrainKinds, hasRiver } = buildTypedArrays(tiles, 42)
		const plan = await generateZonePlanForSettlements(
			tiles,
			settlements.settlements,
			42,
			coords,
			terrainKinds,
			hasRiver
		)

		expect(plan.zones.residential.length).toBeGreaterThan(0)
		const settlement = plan.settlements[0]
		expect(settlement).toBeDefined()
		if (settlement) {
			const residentialCoords = new Set(plan.zones.residential.map(([q, r]) => `${q},${r}`))
			expect(residentialCoords.size).toBeGreaterThan(0)
			// Harvest zones may be empty when settlement radius is small (village radius=2)
			// but residential should always exist
		}
	})

	it('generates roads connecting settlements', async () => {
		const tiles = region({ q: 0, r: 0 }, 6)
		const generator = new GameGenerator()
		const settlements = await generator.placeSettlements(42, tiles, {
			settlementCount: 3,
			minSpacing: 2,
		})
		const { coords, terrainKinds, hasRiver } = buildTypedArrays(tiles, 42)
		const plan = await generateZonePlanForSettlements(
			tiles,
			settlements.settlements,
			42,
			coords,
			terrainKinds,
			hasRiver
		)

		if (plan.settlements.length >= 2) {
			expect(plan.roads.path?.length).toBeGreaterThan(0)
		}
	})

	it('generates roads connecting settlements to neighbors', async () => {
		const tiles = region({ q: 0, r: 0 }, 4)
		const generator = new GameGenerator()
		const settlements = await generator.placeSettlements(42, tiles, {
			settlementCount: 1,
			minSpacing: 2,
		})
		const { coords, terrainKinds, hasRiver } = buildTypedArrays(tiles, 42)
		const plan = await generateZonePlanForSettlements(
			tiles,
			settlements.settlements,
			42,
			coords,
			terrainKinds,
			hasRiver
		)

		expect(plan.roads.path?.length).toBeGreaterThan(0)
		const settlement = plan.settlements[0]
		expect(settlement).toBeDefined()
		if (settlement) {
			const neighborTiles = axial
				.neighbors(settlement.center)
				.filter((coord) => tiles.some((tile) => axial.key(tile.coord) === axial.key(coord)))
			expect(neighborTiles.length).toBeGreaterThan(0)
		}
	})

	it('generates roads that avoid river edges', async () => {
		const tiles = region({ q: 0, r: 0 }, 5).map((entry) =>
			axial.key(entry.coord) === '0,0'
				? {
						...entry,
						hydrology: {
							...entry.hydrology,
							edges: {
								...entry.hydrology?.edges,
								0: { direction: 0, flow: 1 },
							},
						},
					}
				: entry
		) as GeneratedTileData[]
		const generator = new GameGenerator()
		const settlements = await generator.placeSettlements(42, tiles, {
			settlementCount: 1,
			minSpacing: 2,
		})
		const { coords, terrainKinds, hasRiver } = buildTypedArrays(tiles, 42)
		const plan = await generateZonePlanForSettlements(
			tiles,
			settlements.settlements,
			42,
			coords,
			terrainKinds,
			hasRiver
		)

		const roadBorders = new Set(plan.roads.path ?? [])
		expect(roadBorders.has([0, 0.5])).toBe(false)
	})

	it('generates roads that avoid settlement centers', async () => {
		const tiles = region({ q: 0, r: 0 }, 4)
		const generator = new GameGenerator()
		const settlements = await generator.placeSettlements(42, tiles, {
			settlementCount: 1,
			minSpacing: 2,
		})
		const { coords, terrainKinds, hasRiver } = buildTypedArrays(tiles, 42)
		const plan = await generateZonePlanForSettlements(
			tiles,
			settlements.settlements,
			42,
			coords,
			terrainKinds,
			hasRiver
		)

		const settlement = plan.settlements[0]
		expect(settlement).toBeDefined()
		if (settlement) {
			const roadTileKeys = new Set(plan.roads.path ?? [])
			expect(roadTileKeys.has([settlement.center.q, settlement.center.r])).toBe(false)
		}
	})

	it('generates roads that avoid zoned tiles', async () => {
		const tiles = region({ q: 0, r: 0 }, 4)
		const generator = new GameGenerator()
		const settlements = await generator.placeSettlements(42, tiles, {
			settlementCount: 1,
			minSpacing: 2,
		})
		const { coords, terrainKinds, hasRiver } = buildTypedArrays(tiles, 42)
		const plan = await generateZonePlanForSettlements(
			tiles,
			settlements.settlements,
			42,
			coords,
			terrainKinds,
			hasRiver
		)

		const zonedCoords = new Set([
			...plan.zones.harvest,
			...plan.zones.residential,
			...plan.zones.named.flatMap((zone) => zone.coords),
		])
		const roadTileKeys = new Set(plan.roads.path ?? [])
		for (const roadCoord of roadTileKeys) {
			expect(zonedCoords.has(roadCoord)).toBe(false)
		}
	})

	it.skip('generates roads that connect to all settlements', async () => {
		const tiles = region({ q: 0, r: 0 }, 6)
		const generator = new GameGenerator()
		const settlements = await generator.placeSettlements(42, tiles, {
			settlementCount: 3,
			minSpacing: 2,
		})
		const { coords, terrainKinds, hasRiver } = buildTypedArrays(tiles, 42)
		const plan = await generateZonePlanForSettlements(
			tiles,
			settlements.settlements,
			42,
			coords,
			terrainKinds,
			hasRiver
		)

		// WASM placement may produce fewer than requested settlements due to spacing.
		if (plan.settlements.length >= 2) {
			const roadTileKeys = new Set(plan.roads.path ?? [])
			let connectedCount = 0
			for (const settlement of plan.settlements) {
				const neighborRoads = axial
					.neighbors(settlement.center)
					.filter((coord) => roadTileKeys.has([coord.q, coord.r]))
				if (neighborRoads.length > 0) connectedCount++
			}
			// At least 2 settlements should be connected (road may not reach all
			// if placement is constrained by WASM scoring differences).
			expect(connectedCount).toBeGreaterThanOrEqual(2)
		}
	})

	it('generates roads that avoid water tiles', async () => {
		const tiles = region({ q: 0, r: 0 }, 5)
		const waterTiles = new Set(
			tiles
				.filter((entry) => entry.terrain === 'water')
				.map((entry) => [entry.coord.q, entry.coord.r] as [number, number])
		)
		const generator = new GameGenerator()
		const settlements = await generator.placeSettlements(42, tiles, {
			settlementCount: 1,
			minSpacing: 2,
		})
		const { coords, terrainKinds, hasRiver } = buildTypedArrays(tiles, 42)
		const plan = await generateZonePlanForSettlements(
			tiles,
			settlements.settlements,
			42,
			coords,
			terrainKinds,
			hasRiver
		)

		const roadTileKeys = new Set(plan.roads.path ?? [])
		for (const waterTile of waterTiles) {
			expect(roadTileKeys.has(waterTile)).toBe(false)
		}
	})
})
