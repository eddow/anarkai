import { chopSaw } from 'ssh/game/exampleGames'
import { Game } from 'ssh/game/game'
import { describe, expect, it } from 'vitest'

describe('Source Allocation Stability', () => {
	it('ChopSaw scenario runs without Source Allocation errors', {
		timeout: 15000,
	}, async () => {
		const game = new Game(
			{
				boardSize: 12,
				terrainSeed: 1,
				characterCount: 2,
				characterRadius: 3,
			},
			chopSaw
		)
		// Stop ticker to prevent concurrent simulation during test
		game.ticker.stop()

		await game.loaded

		// Scripts are loaded by default in Game population via scriptsContext
		for (const char of game.population) {
			void char.scriptsContext
		}

		// Add extra loose goods to increase chance of concurrent interactions
		const hex = game.hex
		for (let i = 0; i < 10; i++) {
			const tile = hex.getTile({
				q: Math.floor(game.random() * 10) - 5,
				r: Math.floor(game.random() * 10) - 5,
			})
			if (tile) hex.looseGoods.add(tile, 'wood', { position: tile.position })
		}

		let errorFound = false
		const originalError = console.error
		console.error = (...args: any[]) => {
			const msg = args.join(' ')
			if (msg.includes('Source allocation missing')) {
				errorFound = true
			}
			// Still log but avoid circularity by not passing the full mg object
			const safeArgs = args.map((a) => (typeof a === 'object' && a !== null ? '[Object]' : a))
			originalError(...safeArgs)
		}

		try {
			// Bounded regression simulation
			const dt = 0.1
			for (let i = 0; i < 120; i++) {
				game.ticker.update(dt * 1000)
				if (i % 10 === 0) {
					await new Promise((resolve) => setTimeout(resolve, 0))
				}
				if (errorFound) break
			}
		} finally {
			console.error = originalError
		}

		expect(errorFound).toBe(false)
	})
})
