import {
	edgeKey,
	ensureWasmLoaded,
	generateSectorRegionAsync,
	type TerrainSnapshot,
	type TileField,
} from 'engine-terrain'
import { BoardGenerator } from 'ssh/generation/board'
import { axial } from 'ssh/utils'
import { describe, expect, it } from 'vitest'

describe('BoardGenerator riverFlow projection', () => {
	it('projects terrain riverFlow onto hydrology samples for channel tiles', async () => {
		await ensureWasmLoaded()
		const snapshot = await generateSectorRegionAsync(1, [{ q: 0, r: 0 }], {
			sectorStep: 17,
			padding: 1,
			hydrologyPadding: 16,
		})
		expect(snapshot.hydrology.riverFlow?.size ?? 0).toBeGreaterThan(0)

		const board = new BoardGenerator().generateBoard(snapshot)
		const withFlow = board.filter((t) => t.hydrology?.riverFlow !== undefined)
		expect(withFlow.length).toBeGreaterThan(0)

		const landFlow = withFlow.filter((t) => t.terrain !== 'water')
		expect(landFlow.length).toBeGreaterThan(0)
		for (const tile of landFlow) {
			const f = tile.hydrology!.riverFlow!
			expect(f.upstreamDirections.length + f.downstreamDirections.length).toBeGreaterThan(0)
			expect(Number.isFinite(f.rankFromSource)).toBe(true)
			expect(Number.isFinite(f.rankToSea)).toBe(true)
			expect(f.tileRole).not.toBe('none')
		}
	})

	it('does not project river edges across borders where both tiles are water', () => {
		const field: TileField = {
			height: -0.2,
			temperature: 0,
			humidity: 0,
			terrainType: 0,
			rockyNoise: 0,
			sediment: 0,
			waterTable: 1,
		}
		const waterA = { q: 0, r: 0 }
		const waterB = { q: 1, r: 0 }
		const land = { q: 0, r: 1 }
		const waterAKey = axial.key(waterA)
		const waterBKey = axial.key(waterB)
		const landKey = axial.key(land)
		const snapshot: TerrainSnapshot = {
			seed: 1,
			tiles: new Map([
				[waterAKey, field],
				[waterBKey, field],
				[landKey, { ...field, height: 0.1, waterTable: 0 }],
			]),
			biomes: new Map([
				[waterAKey, 'ocean'],
				[waterBKey, 'lake'],
				[landKey, 'grass'],
			]),
			edges: new Map([
				[
					edgeKey(waterAKey, waterBKey),
					{ flux: 10, width: 3, depth: 1, slope: 0.01 },
				],
				[
					edgeKey(waterAKey, landKey),
					{ flux: 8, width: 2, depth: 0.8, slope: 0.01 },
				],
			]),
			hydrology: {
				banks: new Map(),
				channels: new Set(),
				channelInfluence: new Map(),
			},
		}

		const board = new BoardGenerator().generateBoard(snapshot)
		const projectedWaterA = board.find((tile) => axial.key(tile.coord) === waterAKey)!
		const projectedWaterB = board.find((tile) => axial.key(tile.coord) === waterBKey)!
		const projectedLand = board.find((tile) => axial.key(tile.coord) === landKey)!

		expect(projectedWaterA.hydrology?.edges).toBeDefined()
		expect(Object.keys(projectedWaterA.hydrology?.edges ?? {})).toHaveLength(1)
		expect(projectedWaterB.hydrology).toBeUndefined()
		expect(Object.keys(projectedLand.hydrology?.edges ?? {})).toHaveLength(1)
	})
})
