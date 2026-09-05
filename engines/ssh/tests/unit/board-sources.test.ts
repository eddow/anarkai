import { measureGoodAvailability } from 'ssh/commerce/board-sources'
import { Game } from 'ssh/game/game'
import { afterEach, describe, expect, it } from 'vitest'

describe('measureGoodAvailability', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('distinguishes produced (we make it) from held (imported stock) from unproduced', async () => {
		game = new Game(
			{ terrainSeed: 41, characterCount: 0, settlementGeneration: false },
			{
				terrains: {
					grass: [
						[0, 0],
						[0, 1],
						[0, 2],
						[0, 3],
					],
				},
				hives: [
					{
						name: 'Producer',
						// tree_chopper produces wood (harvest output).
						alveoli: [{ coord: [0, 0], alveolus: 'tree_chopper', goods: {} }],
					},
					{
						name: 'Importer',
						// storage merely holds imported concrete — no producer.
						alveoli: [{ coord: [0, 3], alveolus: 'storage', goods: { concrete: 5 } }],
					},
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		const wood = measureGoodAvailability(game, 'wood', { q: 0, r: 2 })
		expect(wood.kind).toBe('produced')
		expect(wood.distance).toBe(2)

		const concrete = measureGoodAvailability(game, 'concrete', { q: 0, r: 2 })
		expect(concrete.kind).toBe('held')
		expect(concrete.distance).toBe(1)

		const stone = measureGoodAvailability(game, 'stone', { q: 0, r: 2 })
		expect(stone.kind).toBe('unproduced')
		expect(stone.distance).toBe(Number.POSITIVE_INFINITY)
	})
})
