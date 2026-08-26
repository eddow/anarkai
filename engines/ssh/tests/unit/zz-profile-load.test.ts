import { Game } from 'ssh/game/game'
import { describe, expect, it } from 'vitest'

describe('profile full game load', () => {
	it('loads with settlement generation', async () => {
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
		game.destroy()
		expect(true).toBe(true)
	}, 60000)
})
