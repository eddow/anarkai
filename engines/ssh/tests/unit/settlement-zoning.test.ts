import { Game } from 'ssh/game/game'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import {
	type GeneratedTileData,
	generateSettlementRegionSetPlan,
	generateSettlementZonePlan,
} from 'ssh/generation'
import { type AxialCoord, axial } from 'ssh/utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

describe('settlement zoning generation', () => {
	const games = new Set<Game>()

	afterEach(() => {
		for (const game of games) game.destroy()
		games.clear()
	})

	it('creates deterministic residential, named production zones, and local roads', () => {
		const tiles = region({ q: 0, r: 0 }, 6)
		const first = generateSettlementZonePlan(tiles, {
			seed: 42,
			maxSettlements: 2,
			minSpacing: 4,
		})
		const second = generateSettlementZonePlan(tiles, {
			seed: 42,
			maxSettlements: 2,
			minSpacing: 4,
		})

		expect(first).toEqual(second)
		expect(first.settlements.length).toBeGreaterThan(0)
		expect(first.zones.residential.length).toBeGreaterThan(0)
		expect(first.zones.harvest.length).toBeGreaterThan(0)
		expect(first.zones.named.map((zone) => zone.id)).toContain('industrial')
		expect(first.roads.path?.length).toBeGreaterThan(0)
	})

	it('describes settlement regions inside a generic region set', () => {
		const tiles = region({ q: 0, r: 0 }, 6)
		const plan = generateSettlementRegionSetPlan(tiles, {
			seed: 42,
			maxSettlements: 2,
			minSpacing: 4,
			regionSetKey: '0,0',
		})

		expect(plan.regionSet).toMatchObject({
			type: 'region-set',
			key: '0,0',
		})
		expect(plan.regionSet.children.length).toBe(plan.settlements.length)
		expect(plan.regionSet.children.every((child) => child.type === 'region')).toBe(true)
		expect(plan.settlements.every((settlement) => settlement.id.startsWith('settlement-0_0-'))).toBe(
			true
		)
	})

	it('does not zone water tiles', () => {
		const tiles = region({ q: 0, r: 0 }, 5)
		const water = new Set(
			tiles.filter((entry) => entry.terrain === 'water').map((entry) => axial.key(entry.coord))
		)
		const plan = generateSettlementZonePlan(tiles, { seed: 9, maxSettlements: 1 })

		const zonedCoords = [
			...plan.zones.harvest,
			...plan.zones.residential,
			...plan.zones.named.flatMap((zone) => zone.coords),
		]
		expect(zonedCoords.some(([q, r]) => water.has(`${q},${r}`))).toBe(false)
	})

	it('keeps generated road corridors unzoned', () => {
		const tiles = region({ q: 0, r: 0 }, 6)
		const plan = generateSettlementZonePlan(tiles, {
			seed: 42,
			maxSettlements: 2,
			minSpacing: 4,
		})
		const zoned = new Set(
			[
				...plan.zones.harvest,
				...plan.zones.residential,
				...plan.zones.named.flatMap((zone) => zone.coords),
			].map(([q, r]) => `${q},${r}`)
		)

		for (const [q, r] of plan.roads.path ?? []) {
			expect(zoned.has(`${Math.floor(q)},${Math.floor(r)}`)).toBe(false)
			expect(zoned.has(`${Math.ceil(q)},${Math.ceil(r)}`)).toBe(false)
		}
	})

	it('does not zone river-influenced tiles', () => {
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
		const plan = generateSettlementZonePlan(tiles, { seed: 42, maxSettlements: 2, minSpacing: 4 })

		const zonedCoords = [
			...plan.zones.harvest,
			...plan.zones.residential,
			...plan.zones.named.flatMap((zone) => zone.coords),
		]
		expect(zonedCoords.some(([q, r]) => riverTiles.has(`${q},${r}`))).toBe(false)
	})

	it('does not place generated roads on river-edge borders', () => {
		const tiles = region({ q: 0, r: 0 }, 5).map((entry) =>
			axial.key(entry.coord) === '0,0'
				? tile(entry.coord, {
						...entry,
						hydrology: {
							isChannel: false,
							edges: { 0: { flux: 1, width: 1, depth: 1 } },
						},
					})
				: entry
		)
		const plan = generateSettlementZonePlan(tiles, { seed: 42, maxSettlements: 1, minSpacing: 3 })

		expect(plan.roads.path ?? []).not.toContainEqual([0.5, 0])
	})

	it('can be enabled from game generation options', async () => {
		const game = new Game(
			{
				terrainSeed: 42,
				characterCount: 0,
				settlementGeneration: { maxSettlements: 1, minSpacing: 3 },
			},
			{ tiles: [{ coord: [0, 0], terrain: 'grass' }] }
		)
		games.add(game)
		await game.loaded
		game.ticker.stop()

		const zoneIds = game.hex.zoneManager.listCustomZoneDefinitions().map((zone) => zone.id)
		expect(zoneIds).toContain('civic')
		expect(zoneIds).toContain('industrial')
		expect(game.hex.zoneManager.coordsForGeneratedZone('residential').length).toBeGreaterThan(0)
		expect(game.hex.roadSegments().length).toBeGreaterThan(0)
	})

	it('generates baseline zones even when explicit zone patches are present', async () => {
		const game = new Game(
			{ terrainSeed: 42, characterCount: 0 },
			{
				tiles: [{ coord: [0, 0], terrain: 'grass' }],
				zones: { harvest: [[0, 0]] },
			}
		)
		games.add(game)
		await game.loaded
		game.ticker.stop()

		const generatedCount =
			game.hex.zoneManager.coordsForGeneratedZone('residential').length +
			game.hex.zoneManager.coordsForGeneratedZone('harvest').length
		expect(generatedCount).toBeGreaterThan(0)
		expect(game.hex.getTile({ q: 0, r: 0 })?.zone).toBe('harvest')
		expect(game.hex.getTile({ q: 0, r: 0 })?.effectiveZone).toBe('harvest')
	})

	it('applies settlement zones and roads to streamed gameplay tiles', async () => {
		const center = { q: 30, r: 0 }
		const game = new Game({
			terrainSeed: 42,
			characterCount: 0,
			settlementGeneration: { maxSettlements: 1, minSpacing: 3 },
		})
		games.add(game)
		await game.loaded
		game.ticker.stop()

		vi.spyOn(game.generator, 'generateRegionAsync').mockResolvedValue(region(center, 6))
		vi.spyOn(game.generator, 'generateSectorsAsync').mockResolvedValue(region(center, 6))

		await game.requestGameplayFrontier(center, 6, { maxBatchSize: 200 })

		const generatedCount =
			game.hex.zoneManager.coordsForGeneratedZone('residential').length +
			game.hex.zoneManager.coordsForGeneratedZone('harvest').length
		expect(generatedCount).toBeGreaterThan(0)
		expect(game.hex.zoneManager.listCustomZoneDefinitions().map((zone) => zone.id)).toContain(
			'industrial'
		)
		expect(game.hex.roadSegments().length).toBeGreaterThan(0)
		expect(game.hex.zoneManager.coordsForGeneratedZone('npc-factory')).toHaveLength(0)
		expect(game.hex.zoneManager.coordsForGeneratedZone('npc-residential-commercial')).toHaveLength(0)
	})

	it('applies settlement zones and roads to settled sector gameplay tiles', async () => {
		const center = { q: 85, r: 85 }
		const game = new Game({
			terrainSeed: 42,
			characterCount: 0,
			settlementGeneration: { maxSettlements: 1, minSpacing: 3 },
		})
		games.add(game)
		await game.loaded
		game.ticker.stop()

		vi.spyOn(game.generator, 'generateSectorsAsync').mockResolvedValue(region(center, 6))

		await game.ensureGameplaySectors(['5,5'])

		const generatedCount =
			game.hex.zoneManager.coordsForGeneratedZone('residential').length +
			game.hex.zoneManager.coordsForGeneratedZone('harvest').length
		expect(generatedCount).toBeGreaterThan(0)
		expect(game.hex.zoneManager.listCustomZoneDefinitions().map((zone) => zone.id)).toContain(
			'industrial'
		)
		expect(game.hex.roadSegments().length).toBeGreaterThan(0)
		expect(game.hex.zoneManager.coordsForGeneratedZone('npc-factory')).toHaveLength(0)
		expect(game.hex.zoneManager.coordsForGeneratedZone('npc-residential-commercial')).toHaveLength(0)
	})

	it('keeps generated roads and non-harvest generated zones clear of deposits and initial loose goods', async () => {
		const center = { q: 85, r: 85 }
		const game = new Game({
			terrainSeed: 42,
			characterCount: 0,
			settlementGeneration: { maxSettlements: 1, minSpacing: 3 },
		})
		games.add(game)
		await game.loaded
		game.ticker.stop()

		vi.spyOn(game.generator, 'generateSectorsAsync').mockResolvedValue(
			region(center, 6).map((entry) => ({
				...entry,
				deposit: entry.terrain === 'grass' ? { type: 'rock', amount: 3 } : entry.deposit,
				goods: { wood: 1 },
			}))
		)

		await game.ensureGameplaySectors(['5,5'], { populateInitialGoods: true })

		for (const segment of game.hex.roadSegments()) {
			const border = game.hex.getBorder(segment.coord)
			if (!border) continue
			for (const tile of [border.tile.a, border.tile.b]) {
				if (!(tile.content instanceof UnBuiltLand)) continue
				expect(tile.content.deposit).toBeUndefined()
				expect(tile.looseGoods).toHaveLength(0)
			}
		}

		for (const definition of game.hex.zoneManager.listCustomZoneDefinitions()) {
			for (const coord of game.hex.zoneManager.coordsForGeneratedZone(definition.id)) {
				const tile = game.hex.getTile(coord)
				if (!(tile?.content instanceof UnBuiltLand)) continue
				expect(tile.content.deposit).toBeUndefined()
				expect(tile.looseGoods).toHaveLength(0)
			}
		}
	})

	it('does not derive settlement zones from render-only terrain generation', async () => {
		const center = { q: 40, r: 0 }
		const game = new Game({
			terrainSeed: 42,
			characterCount: 0,
			settlementGeneration: { maxSettlements: 1, minSpacing: 3 },
		})
		games.add(game)
		await game.loaded
		game.ticker.stop()

		vi.spyOn(game.generator, 'generateRegionAsync').mockResolvedValue(region(center, 6))

		await game.ensureTerrainSamples([center])

		expect(game.hex.getTileContent(center)).toBeUndefined()
		const generatedCount =
			game.hex.zoneManager.coordsForGeneratedZone('residential').length +
			game.hex.zoneManager.coordsForGeneratedZone('harvest').length
		expect(generatedCount).toBe(0)
		expect(game.hex.roadSegments()).toHaveLength(0)
		expect(game.hex.zoneManager.coordsForGeneratedZone('npc-factory')).toHaveLength(0)
		expect(game.hex.zoneManager.coordsForGeneratedZone('npc-residential-commercial')).toHaveLength(0)
	})
})
