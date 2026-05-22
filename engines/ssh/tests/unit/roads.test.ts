import { TileBorderContent } from 'ssh/board/border/border'
import {
	borderHasRiver,
	canBuildRoadAcrossBorder,
	canBuildRoadOnTrace,
	ROAD_WALK_TIME_MULTIPLIERS,
	roadBordersForTrace,
	straightRoadCoords,
	straightRoadTileTrace,
} from 'ssh/board/roads'
import { Game } from 'ssh/game/game'
import type { Storage } from 'ssh/storage/storage'
import { axial } from 'ssh/utils'
import { describe, expect, it } from 'vitest'

function clearRoadBurden(
	...tiles: Array<{
		content?: { deposit?: unknown }
		looseGoods?: Array<{ remove(): void }>
		terrainHydrology?: unknown
		terrainState?: { hydrology?: unknown }
	}>
) {
	for (const tile of tiles) {
		tile.terrainHydrology = undefined
		if (tile.terrainState) tile.terrainState = { ...tile.terrainState, hydrology: undefined }
		if (tile.content && 'deposit' in tile.content) tile.content.deposit = undefined
		for (const good of [...(tile.looseGoods ?? [])]) good.remove()
	}
}

describe('road traces', () => {
	it('includes endpoints and keeps every step adjacent', () => {
		const trace = straightRoadCoords({ q: 0, r: 0 }, { q: 3, r: -1 })
		expect({ q: trace[0]!.q, r: trace[0]!.r }).toEqual({ q: 0, r: 0 })
		expect({ q: trace.at(-1)!.q, r: trace.at(-1)!.r }).toEqual({ q: 3, r: -1 })
		for (let i = 1; i < trace.length; i++) {
			expect(axial.distance(trace[i - 1]!, trace[i]!)).toBe(1)
		}
	})

	it('returns a single tile for zero-length traces', () => {
		expect(straightRoadCoords({ q: 2, r: -1 }, { q: 2, r: -1 })).toEqual([{ q: 2, r: -1 }])
	})

	it('converts a tile trace to shared borders', async () => {
		const game = new Game(
			{ terrainSeed: 1234, characterCount: 0, settlementGeneration: false },
			{ tiles: [{ coord: [0, 0], terrain: 'grass' }] }
		)
		await game.loaded
		game.ticker.stop()

		try {
			const start = game.hex.getTile({ q: 0, r: 0 })!
			const end = game.hex.getTile({ q: 2, r: 0 })!
			const trace = straightRoadTileTrace(start, end)
			expect(trace.map((tile) => axial.key(tile.position))).toEqual(['0,0', '1,0', '2,0'])
			expect(roadBordersForTrace(trace).map((border) => axial.key(border.position))).toEqual([
				'0.5,0',
				'1.5,0',
			])
		} finally {
			game.destroy()
		}
	})
})

describe('road storage', () => {
	it('stores road types independently from border content and roundtrips through saves', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
		}
		const game = new Game(
			{ terrainSeed: 1234, characterCount: 0, settlementGeneration: false },
			patches
		)
		await game.loaded
		game.ticker.stop()

		try {
			const border = game.hex.getTile({ q: 0, r: 0 })!.borderWith({ q: 1, r: 0 })!
			class DummyBorderContent extends TileBorderContent {
				readonly storage?: Storage
				readonly debugInfo = {}
				constructor(readonly border: typeof border) {
					super(border.game)
				}
			}
			const content = new DummyBorderContent(border)
			game.hex.setBorderContent(border.position, content)
			game.hex.setRoadType(border.position, 'path')

			expect(game.hex.getBorderContent(border.position)?.debugInfo).toEqual(content.debugInfo)
			expect(game.hex.getRoadType(border.position)).toBe('path')

			const save = game.saveGameData()
			expect(save.roads).toEqual({ path: [[0.5, 0]] })

			const restored = new Game(save.generationOptions, save, save)
			await restored.loaded
			restored.ticker.stop()
			try {
				expect(restored.hex.getRoadType({ q: 0.5, r: 0 })).toBe('path')
			} finally {
				restored.destroy()
			}
		} finally {
			game.destroy()
		}
	})

	it('loads legacy array-shaped road patches', async () => {
		const game = new Game(
			{ terrainSeed: 1234, characterCount: 0, settlementGeneration: false },
			{
				tiles: [
					{ coord: [0, 0], terrain: 'grass' },
					{ coord: [1, 0], terrain: 'grass' },
				],
				roads: [{ coord: [0.5, 0], type: 'path' }],
			}
		)
		await game.loaded
		game.ticker.stop()

		try {
			expect(game.hex.getRoadType({ q: 0.5, r: 0 })).toBe('path')
		} finally {
			game.destroy()
		}
	})

	it('roundtrips asphalt roads and applies their faster walk multiplier', async () => {
		const game = new Game(
			{ terrainSeed: 1234, characterCount: 0, settlementGeneration: false },
			{
				tiles: [
					{ coord: [0, 0], terrain: 'grass' },
					{ coord: [1, 0], terrain: 'grass' },
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		try {
			const start = game.hex.getTile({ q: 0, r: 0 })!
			const roaded = game.hex.getTile({ q: 1, r: 0 })!
			clearRoadBurden(start, roaded)
			game.hex.setRoadType(start.borderWith(roaded)!.position, 'asphalt')

			const roadNeighbor = game.hex
				.getNeighbors(start.position)
				.find((neighbor) => axial.key(neighbor.coord) === axial.key(roaded.position))
			expect(roadNeighbor?.walkTime).toBe(
				roaded.effectiveWalkTime * ROAD_WALK_TIME_MULTIPLIERS.asphalt
			)

			const save = game.saveGameData()
			expect(save.roads).toEqual({ asphalt: [[0.5, 0]] })
		} finally {
			game.destroy()
		}
	})

	it('reduces walk cost only when crossing a roaded border', async () => {
		const game = new Game(
			{ terrainSeed: 1234, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0], terrain: 'grass' },
					{ coord: [1, 0], terrain: 'grass' },
					{ coord: [0, 1], terrain: 'grass' },
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		try {
			const start = game.hex.getTile({ q: 0, r: 0 })!
			const roaded = game.hex.getTile({ q: 1, r: 0 })!
			const offroad = game.hex.getTile({ q: 0, r: 1 })!
			clearRoadBurden(start, roaded, offroad)
			game.hex.setRoadType(start.borderWith(roaded)!.position, 'path')

			const roadNeighbor = game.hex
				.getNeighbors(start.position)
				.find((neighbor) => axial.key(neighbor.coord) === axial.key(roaded.position))
			const offroadNeighbor = game.hex
				.getNeighbors(start.position)
				.find((neighbor) => axial.key(neighbor.coord) === axial.key(offroad.position))

			expect(roadNeighbor?.walkTime).toBe(
				roaded.effectiveWalkTime * ROAD_WALK_TIME_MULTIPLIERS.path
			)
			expect(offroadNeighbor?.walkTime).toBe(offroad.effectiveWalkTime)
		} finally {
			game.destroy()
		}
	})

	it('cancels the road walk bonus while either road tile is burdened', async () => {
		const game = new Game(
			{ terrainSeed: 1234, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0], terrain: 'grass' },
					{ coord: [1, 0], terrain: 'grass' },
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		try {
			const start = game.hex.getTile({ q: 0, r: 0 })!
			const roaded = game.hex.getTile({ q: 1, r: 0 })!
			clearRoadBurden(start, roaded)
			game.hex.setRoadType(start.borderWith(roaded)!.position, 'path')
			game.hex.looseGoods.add(roaded, 'wood')

			const roadNeighbor = game.hex
				.getNeighbors(start.position)
				.find((neighbor) => axial.key(neighbor.coord) === axial.key(roaded.position))

			expect(roadNeighbor?.walkTime).toBe(roaded.effectiveWalkTime)
		} finally {
			game.destroy()
		}
	})
})

describe('road build validation', () => {
	it('allows empty generated terrain tiles', async () => {
		const game = new Game({ terrainSeed: 1234, characterCount: 0 })
		await game.loaded
		game.ticker.stop()

		try {
			const start = game.hex.getTile({ q: 0, r: 0 })!
			const end = game.hex.getTile({ q: 1, r: 0 })!
			expect(start.content).toBeUndefined()
			expect(end.content).toBeUndefined()
			expect(canBuildRoadOnTrace(straightRoadTileTrace(start, end))).toBe(true)
		} finally {
			game.destroy()
		}
	})

	it('allows clear land and freight bays but rejects non-bay hive alveoli', async () => {
		const game = new Game(
			{ terrainSeed: 1234, characterCount: 0 },
			{
				tiles: [
					{ coord: [-1, 0], terrain: 'grass' },
					{ coord: [0, 0], terrain: 'grass' },
					{ coord: [1, 0], terrain: 'grass' },
				],
				hives: [
					{
						name: 'Hive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'freight_bay' },
							{ coord: [1, 0], alveolus: 'sawmill' },
						],
					},
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		try {
			const land = game.hex.getTile({ q: -1, r: 0 })!
			const bay = game.hex.getTile({ q: 0, r: 0 })!
			const sawmill = game.hex.getTile({ q: 1, r: 0 })!
			expect(canBuildRoadOnTrace(straightRoadTileTrace(land, bay))).toBe(true)
			expect(canBuildRoadOnTrace(straightRoadTileTrace(bay, sawmill))).toBe(false)
		} finally {
			game.destroy()
		}
	})

	it('rejects residential tiles and planned construction projects', async () => {
		const game = new Game(
			{ terrainSeed: 1234, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0], terrain: 'grass' },
					{ coord: [1, 0], terrain: 'grass' },
					{ coord: [2, 0], terrain: 'grass' },
				],
				zones: { residential: [[0, 0]] },
				projects: { 'build:sawmill': [[2, 0]] },
			}
		)
		await game.loaded
		game.ticker.stop()

		try {
			const residential = game.hex.getTile({ q: 0, r: 0 })!
			const land = game.hex.getTile({ q: 1, r: 0 })!
			const project = game.hex.getTile({ q: 2, r: 0 })!
			expect(canBuildRoadOnTrace(straightRoadTileTrace(residential, land))).toBe(false)
			expect(canBuildRoadOnTrace(straightRoadTileTrace(land, project))).toBe(false)
		} finally {
			game.destroy()
		}
	})

	it('rejects traces that pass through forbidden middle tiles', async () => {
		const game = new Game(
			{ terrainSeed: 1234, characterCount: 0 },
			{
				tiles: [
					{ coord: [-1, 0], terrain: 'grass' },
					{ coord: [0, 0], terrain: 'grass' },
					{ coord: [1, 0], terrain: 'grass' },
				],
				zones: { residential: [[0, 0]] },
			}
		)
		await game.loaded
		game.ticker.stop()

		try {
			const start = game.hex.getTile({ q: -1, r: 0 })!
			const end = game.hex.getTile({ q: 1, r: 0 })!
			const trace = straightRoadTileTrace(start, end)
			expect(trace.map((tile) => axial.key(tile.position))).toEqual(['-1,0', '0,0', '1,0'])
			expect(canBuildRoadOnTrace(trace)).toBe(false)
		} finally {
			game.destroy()
		}
	})

	it('rejects water terrain tiles', async () => {
		const game = new Game(
			{ terrainSeed: 1234, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0], terrain: 'grass' },
					{ coord: [1, 0], terrain: 'water' },
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		try {
			const land = game.hex.getTile({ q: 0, r: 0 })!
			const water = game.hex.getTile({ q: 1, r: 0 })!
			expect(canBuildRoadOnTrace(straightRoadTileTrace(land, water))).toBe(false)
			const border = land.borderWith(water)!
			game.hex.setRoadType(border.position, 'path')
			expect(game.hex.getRoadType(border.position)).toBeUndefined()
		} finally {
			game.destroy()
		}
	})

	it('allows river tiles when the road does not share the river border', async () => {
		const game = new Game(
			{ terrainSeed: 1234, characterCount: 0 },
			{
				tiles: [
					{ coord: [-1, 0], terrain: 'grass' },
					{ coord: [0, 0], terrain: 'grass' },
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		try {
			const riverTile = game.hex.getTile({ q: 0, r: 0 })!
			riverTile.terrainHydrology = {
				isChannel: true,
				edges: {
					0: { flux: 1, width: 1, depth: 1 },
				},
			}
			const land = game.hex.getTile({ q: -1, r: 0 })!
			expect(canBuildRoadOnTrace(straightRoadTileTrace(land, riverTile))).toBe(true)
		} finally {
			game.destroy()
		}
	})

	it('rejects roads on the same border as a river edge', async () => {
		const game = new Game(
			{ terrainSeed: 1234, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0], terrain: 'grass' },
					{ coord: [1, 0], terrain: 'grass' },
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		try {
			const start = game.hex.getTile({ q: 0, r: 0 })!
			const end = game.hex.getTile({ q: 1, r: 0 })!
			start.terrainHydrology = {
				isChannel: true,
				edges: {
					0: { flux: 1, width: 1, depth: 1 },
				},
			}
			const border = start.borderWith(end)!
			expect(borderHasRiver(border)).toBe(true)
			expect(canBuildRoadAcrossBorder(border)).toBe(false)
			expect(canBuildRoadOnTrace(straightRoadTileTrace(start, end))).toBe(false)
			game.hex.setRoadType(border.position, 'path')
			expect(game.hex.getRoadType(border.position)).toBeUndefined()
		} finally {
			game.destroy()
		}
	})
})
