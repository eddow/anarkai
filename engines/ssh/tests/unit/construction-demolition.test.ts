import { Alveolus } from 'ssh/board/content/alveolus'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import {
	demolishRoadSegment,
	demolishStructure,
	demolitionRefundGoods,
} from 'ssh/construction-demolition'
import { Game } from 'ssh/game/game'
import { describe, expect, it } from 'vitest'

const foresterGame = () =>
	new Game(
		{ terrainSeed: 1, characterCount: 0, settlementGeneration: false },
		{
			terrains: { grass: [[0, 0]] },
			hives: [{ name: 'H', alveoli: [{ coord: [0, 0] as const, alveolus: 'forester' as const }] }],
		}
	)

describe('construction demolition', () => {
	it('refunds construction materials probabilistically', async () => {
		const game = foresterGame()
		await game.loaded
		game.ticker.stop()
		try {
			const content = game.hex.getTile({ q: 0, r: 0 })!.content as Alveolus
			// Mock forester construction = { wood: 1 } + foundation { concrete: 1 }.
			expect(demolitionRefundGoods(content, () => 0)).toEqual({ wood: 1, concrete: 1 })
			expect(demolitionRefundGoods(content, () => 0.999)).toEqual({})
		} finally {
			game.destroy()
		}
	})

	it('demolishes a structure into UnBuiltLand and detaches it from its hive', async () => {
		const game = foresterGame()
		await game.loaded
		game.ticker.stop()
		try {
			const tile = game.hex.getTile({ q: 0, r: 0 })!
			const alveolus = tile.content as Alveolus
			expect(tile.content instanceof Alveolus).toBe(true)

			demolishStructure(tile)

			expect(tile.content instanceof UnBuiltLand).toBe(true)
			expect(alveolus.hive.alveoli.has(alveolus)).toBe(false)
		} finally {
			game.destroy()
		}
	})

	it('removes a road segment by border midpoint', async () => {
		const game = new Game(
			{ terrainSeed: 2, characterCount: 0, settlementGeneration: false },
			{
				terrains: {
					grass: [
						[0, 0],
						[0, 1],
					],
				},
			}
		)
		await game.loaded
		game.ticker.stop()
		try {
			// Border between (0,0) and (0,1): midpoint (0, 0.5).
			game.hex.setRoadType({ q: 0, r: 0.5 }, 'path')
			expect(game.hex.getRoadType({ q: 0, r: 0.5 })).toBe('path')

			demolishRoadSegment(game, [0, 0.5])

			expect(game.hex.getRoadType({ q: 0, r: 0.5 })).toBeUndefined()
		} finally {
			game.destroy()
		}
	})
})
