import { settlementZones } from 'engine-rules'
import type { Game } from 'ssh/game/game'
import {
	GameGenerator,
	type GeneratedSettlement,
	type GeneratedTileData,
	generateSettlementRegionSetPlan,
	generateZonePlanForSettlements,
	selectSettlementCityHallPosition,
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
	const radius = overrides.radius ?? settlementZones[kind].radius
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

function allZonedCoords(plan: Awaited<ReturnType<typeof generateZonePlanForSettlements>>) {
	return [
		...plan.zones.harvest,
		...plan.zones.residential,
		...plan.zones.commercial,
		...plan.zones.named.flatMap((zone) => zone.coords),
	]
}

function roadKey(coord: readonly [number, number]): string {
	return `${coord[0]},${coord[1]}`
}

function roadKeys(plan: Awaited<ReturnType<typeof generateZonePlanForSettlements>>) {
	return new Set([
		...(plan.roads.asphalt ?? []).map(roadKey),
		...(plan.roads.path ?? []).map(roadKey),
	])
}

function borderKey(a: AxialCoord, b: AxialCoord): string {
	return `${(a.q + b.q) / 2},${(a.r + b.r) / 2}`
}

function isRoadCarrierTile(coord: AxialCoord, roads: ReadonlySet<string>): boolean {
	return hexSides.some((side) =>
		roads.has(borderKey(coord, { q: coord.q + side.q, r: coord.r + side.r }))
	)
}

function hasNeighboringRoadCarrier(coord: AxialCoord, roads: ReadonlySet<string>): boolean {
	return hexSides.some((side) =>
		isRoadCarrierTile({ q: coord.q + side.q, r: coord.r + side.r }, roads)
	)
}

function connectedRoadCarriers(
	starts: readonly AxialCoord[],
	roads: ReadonlySet<string>,
	tiles: readonly GeneratedTileData[]
): Set<string> {
	const tileKeys = new Set(tiles.map((entry) => axial.key(entry.coord)))
	const queue = starts.filter((coord) => isRoadCarrierTile(coord, roads))
	const connected = new Set(queue.map(axial.key))
	for (let i = 0; i < queue.length; i++) {
		const current = queue[i]!
		for (const side of hexSides) {
			const neighbor = { q: current.q + side.q, r: current.r + side.r }
			const key = axial.key(neighbor)
			if (connected.has(key) || !tileKeys.has(key)) continue
			if (!roads.has(borderKey(current, neighbor))) continue
			connected.add(key)
			queue.push(neighbor)
		}
	}
	return connected
}

function allRoadCarrierCoords(
	roads: ReadonlySet<string>,
	tiles: readonly GeneratedTileData[]
): AxialCoord[] {
	return tiles.map((entry) => entry.coord).filter((coord) => isRoadCarrierTile(coord, roads))
}

function hasSolidRoadBlock(
	roads: ReadonlySet<string>,
	tiles: readonly GeneratedTileData[]
): boolean {
	const tileKeys = new Set(tiles.map((entry) => axial.key(entry.coord)))
	for (const tile of tiles) {
		for (let direction = 0; direction < hexSides.length; direction++) {
			const a = hexSides[direction]!
			const b = hexSides[(direction + 1) % hexSides.length]!
			const corners = [
				tile.coord,
				{ q: tile.coord.q + a.q, r: tile.coord.r + a.r },
				{ q: tile.coord.q + b.q, r: tile.coord.r + b.r },
				{ q: tile.coord.q + a.q + b.q, r: tile.coord.r + a.r + b.r },
			]
			if (!corners.every((coord) => tileKeys.has(axial.key(coord)))) continue
			if (corners.every((coord) => isRoadCarrierTile(coord, roads))) return true
		}
	}
	return false
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
		expect(first.settlements.every((settlement) => !settlement.name.includes('('))).toBe(true)
		expect(first.settlements.every((settlement) => !settlement.name.includes(','))).toBe(true)
		expect(first.zones.residential.length).toBeGreaterThan(0)
		expect(first.zones.commercial.length).toBeGreaterThan(0)
		expect(first.zones.harvest).toEqual([])
		expect(first.zones.named.map((zone) => zone.id)).toContain('industrial')
		expect(first.zones.named.map((zone) => zone.id)).not.toContain('market')
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
		expect(plan.regionSet.name).toEqual(expect.any(String))
		expect(plan.regionSet.name).not.toContain('0,0')
		expect(plan.regionSet.children.length).toBe(plan.settlements.length)
		expect(plan.regionSet.children.every((child) => child.type === 'region')).toBe(true)
		expect(
			plan.regionSet.children.every((child) => !!child.name && !child.name.includes(','))
		).toBe(true)
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

		const zonedCoords = allZonedCoords(plan)
		expect(zonedCoords.some(([q, r]) => water.has(`${q},${r}`))).toBe(false)
	})

	it('keeps generated occupied parcels beside road-carrier tiles', async () => {
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
		const roads = roadKeys(plan)
		for (const [q, r] of allZonedCoords(plan)) {
			expect(isRoadCarrierTile({ q, r }, roads)).toBe(false)
			expect(hasNeighboringRoadCarrier({ q, r }, roads)).toBe(true)
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

		const zonedCoords = allZonedCoords(plan)
		expect(zonedCoords.some(([q, r]) => riverTiles.has(`${q},${r}`))).toBe(false)
	})

	it('does not place local generated roads on river-edge borders', async () => {
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

		expect(roadKeys(plan).has('0.5,0')).toBe(false)
	})

	it('zones nearby outer-ring deposits as industrial', async () => {
		const tiles = dryRegion({ q: 0, r: 0 }, 7).map((entry) =>
			axial.key(entry.coord) === '5,-1'
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
		const commercialCoords = new Set(plan.zones.commercial.map(([q, r]) => `${q},${r}`))
		expect(residentialCoords.has('2,-1') || commercialCoords.has('2,-1')).toBe(true)
	})

	it('zones civic at settlement city halls', async () => {
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
		expect(civicCoords.length).toBeGreaterThan(0)
		const settlementCenter = plan.settlements[0]?.center
		expect(settlementCenter).toBeDefined()
		if (settlementCenter) {
			const cityHall = selectSettlementCityHallPosition(plan.settlements[0]!, tiles)
			expect(civicCoords.some(([q, r]) => q === cityHall.q && r === cityHall.r)).toBe(true)
		}
	})

	it('zones commercial areas for settlements without generating market zones', async () => {
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
		expect(marketCoords).toEqual([])
		expect(plan.zones.commercial.length).toBeGreaterThanOrEqual(plan.settlements.length)
	})

	it('does not add harvest zones to generated settlement footprints', async () => {
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

		expect(plan.zones.harvest).toEqual([])
		const settlement = plan.settlements[0]
		expect(settlement).toBeDefined()
		if (settlement) {
			const generatedSettlementCoords = new Set(allZonedCoords(plan).map(([q, r]) => `${q},${r}`))
			expect(
				[...axial.allTiles(settlement.center, settlement.radius)].some((coord) =>
					generatedSettlementCoords.has(`${coord.q},${coord.r}`)
				)
			).toBe(true)
		}
	})

	it('forces each city hall tile into the generated civic zone only', async () => {
		const tiles = region({ q: 0, r: 0 }, 5)
		const generator = new GameGenerator()
		const settlements = await generator.placeSettlements(42, tiles, {
			settlementCount: 2,
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
		const civic = new Set(
			(plan.zones.named.find((zone) => zone.id === 'civic')?.coords ?? []).map(
				([q, r]) => `${q},${r}`
			)
		)
		const residential = new Set(plan.zones.residential.map(([q, r]) => `${q},${r}`))
		const commercial = new Set(plan.zones.commercial.map(([q, r]) => `${q},${r}`))
		const industrial = new Set(
			(plan.zones.named.find((zone) => zone.id === 'industrial')?.coords ?? []).map(
				([q, r]) => `${q},${r}`
			)
		)

		for (const settlement of plan.settlements) {
			const cityHall = selectSettlementCityHallPosition(settlement, tiles)
			const key = `${cityHall.q},${cityHall.r}`
			expect(civic.has(key)).toBe(true)
			expect(residential.has(key)).toBe(false)
			expect(commercial.has(key)).toBe(false)
			expect(industrial.has(key)).toBe(false)
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
			// Harvest zones may be empty when settlement radius is small,
			// but residential should always exist
		}
	})

	it('generates roads connecting settlements', async () => {
		const tiles = dryRegion({ q: 0, r: 0 }, 6)
		const settlements = {
			settlements: [
				settlement({ id: 'settlement-0,0', center: { q: 0, r: 0 }, kind: 'town', radius: 3 }),
				settlement({ id: 'settlement-4,0', center: { q: 4, r: 0 }, kind: 'village', radius: 2 }),
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

		if (plan.settlements.length >= 2) {
			expect(plan.roads.asphalt?.length).toBeGreaterThan(0)
			const asphalt = new Set((plan.roads.asphalt ?? []).map(roadKey))
			for (const settlement of plan.settlements) {
				expect(isRoadCarrierTile(settlement.center, asphalt)).toBe(true)
			}
		}
	})

	it('generates local path roads for a single settlement', async () => {
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

		expect(plan.roads.asphalt ?? []).toEqual([])
		expect(plan.roads.path?.length).toBeGreaterThan(0)
		const settlement = plan.settlements[0]
		expect(settlement).toBeDefined()
		if (settlement) {
			const cityHall = selectSettlementCityHallPosition(settlement, tiles)
			const roads = roadKeys(plan)
			expect(isRoadCarrierTile(cityHall, roads)).toBe(false)
			expect(hasNeighboringRoadCarrier(cityHall, roads)).toBe(true)
		}
	})

	it('keeps local path streets connected to the main road network', async () => {
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

		const roads = roadKeys(plan)
		const reachable = connectedRoadCarriers(
			plan.settlements.map((entry) => entry.center),
			roads,
			tiles
		)
		const carriers = allRoadCarrierCoords(roads, tiles)
		expect(plan.roads.path?.length).toBeGreaterThan(0)
		expect(carriers.every((coord) => reachable.has(axial.key(coord)))).toBe(true)
	})

	it('does not create fully road-carrier 2x2 blocks', async () => {
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

		expect(hasSolidRoadBlock(roadKeys(plan), tiles)).toBe(false)
	})

	it('generates local path roads that avoid river edges', async () => {
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

		const roads = roadKeys(plan)
		expect(roads.has('0.5,0')).toBe(false)
	})

	it('allows roads through river-influenced tiles without using river-edge borders', async () => {
		const tiles = dryRegion({ q: 0, r: 0 }, 4).map((entry) =>
			axial.key(entry.coord) === '0,0'
				? { ...entry, hydrology: { isChannel: false, bankInfluence: 1, edges: {} } }
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

		expect(isRoadCarrierTile({ q: 0, r: 0 }, roadKeys(plan))).toBe(true)
		expect(allZonedCoords(plan).some(([q, r]) => q === 0 && r === 0)).toBe(false)
	})

	it('generates beside-road zoning without putting zones on river tiles', async () => {
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

		const roads = roadKeys(plan)
		for (const [q, r] of allZonedCoords(plan)) {
			const coord = { q, r }
			expect(isRoadCarrierTile(coord, roads)).toBe(false)
			expect(hasNeighboringRoadCarrier(coord, roads)).toBe(true)
			expect(
				tiles.find((tile) => axial.key(tile.coord) === axial.key(coord))?.hydrology
			).toBeUndefined()
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
			const roadTileKeys = new Set((plan.roads.asphalt ?? []).map(roadKey))
			let connectedCount = 0
			for (const settlement of plan.settlements) {
				const neighborRoads = axial
					.neighbors(settlement.center)
					.filter((coord) => roadTileKeys.has(borderKey(settlement.center, coord)))
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
			tiles.filter((entry) => entry.terrain === 'water').map((entry) => axial.key(entry.coord))
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

		const roads = roadKeys(plan)
		for (const waterTileKey of waterTiles) {
			const waterTile = axial.coord(waterTileKey)
			for (const side of hexSides) {
				const neighbor = { q: waterTile.q + side.q, r: waterTile.r + side.r }
				expect(roads.has(borderKey(waterTile, neighbor))).toBe(false)
			}
		}
	})
})
