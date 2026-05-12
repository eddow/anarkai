import { TileBorderContent } from 'ssh/board/border/border'
import { roadBordersForTrace, straightRoadCoords, straightRoadTileTrace } from 'ssh/board/roads'
import { Game } from 'ssh/game/game'
import type { Storage } from 'ssh/storage/storage'
import { axial } from 'ssh/utils'
import { describe, expect, it } from 'vitest'

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
			{ terrainSeed: 1234, characterCount: 0 },
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
		const game = new Game({ terrainSeed: 1234, characterCount: 0 }, patches)
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
			expect(save.roads).toEqual([{ coord: [0.5, 0], type: 'path' }])

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
})
