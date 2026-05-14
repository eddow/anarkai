import { Rectangle } from 'pixi.js'
import type { RenderableTerrainTile } from 'ssh/game/game'
import { describe, expect, it } from 'vitest'
import { SectorTerrainBaker } from './terrain-sector-baker'

describe('SectorTerrainBaker', () => {
	it('reports generated zone tiles for baked overview overlays', () => {
		const baker = new SectorTerrainBaker({} as any)
		const terrainTiles = new Map<string, RenderableTerrainTile>([
			[
				'0,0',
				{
					terrain: 'grass',
					height: 0,
					zone: {
						id: 'market',
						name: 'Market',
						color: '#d6a34c',
						generated: true,
					},
				},
			],
			['1,0', { terrain: 'rocky', height: 0.1 }],
		])

		const debug = baker.inspect({
			sectorKey: '0,0',
			displayBounds: new Rectangle(-100, -100, 200, 200),
			interiorTileCoords: [
				{ q: 0, r: 0 },
				{ q: 1, r: 0 },
			],
			bakeTileCoords: [
				{ q: 0, r: 0 },
				{ q: 1, r: 0 },
			],
			terrainTiles,
			lodMode: 'overview-coarse',
		})

		expect(debug.generatedZoneTileCount).toBe(1)
	})

	it('keeps river diagnostics at texture LOD when hydrology is included', () => {
		const baker = new SectorTerrainBaker({} as any)
		const terrainTiles = new Map<string, RenderableTerrainTile>([
			[
				'0,0',
				{
					terrain: 'grass',
					height: 0,
					hydrology: {
						isChannel: true,
						edges: {
							0: { flux: 1, width: 1, depth: 1 },
						},
					},
				},
			],
		])

		const debug = baker.inspect({
			sectorKey: '0,0',
			displayBounds: new Rectangle(-100, -100, 200, 200),
			interiorTileCoords: [{ q: 0, r: 0 }],
			bakeTileCoords: [{ q: 0, r: 0 }],
			terrainTiles,
			lodMode: 'texture',
			includeRivers: true,
		})

		expect(debug.riverTileCount).toBe(1)
		expect(debug.riverBranchCount).toBe(1)
	})

	it('reports simplified road lines when detailed road textures are absent', () => {
		const baker = new SectorTerrainBaker({} as any)
		const terrainTiles = new Map<string, RenderableTerrainTile>([
			['0,0', { terrain: 'grass', height: 0 }],
			['1,0', { terrain: 'grass', height: 0 }],
		])

		const debug = baker.inspect({
			sectorKey: '0,0',
			displayBounds: new Rectangle(-100, -100, 240, 240),
			interiorTileCoords: [
				{ q: 0, r: 0 },
				{ q: 1, r: 0 },
			],
			bakeTileCoords: [
				{ q: 0, r: 0 },
				{ q: 1, r: 0 },
			],
			terrainTiles,
			lodMode: 'texture',
			roadLineSegments: [{ coord: { q: 0.5, r: 0 }, type: 'path' }],
		})

		expect(debug.roadTileCount).toBe(1)
	})
})
