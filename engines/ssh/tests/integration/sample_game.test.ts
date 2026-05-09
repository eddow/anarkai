import { saw } from 'ssh/game/exampleGames'
import { Game } from 'ssh/game/game'
import { describe, expect, it } from 'vitest'

describe('Source Allocation Stability', () => {
	it('saw scenario produces planks from stored wood by the end of the day', async () => {
		const game = new Game(
			{
				terrainSeed: 1,
				characterCount: 1,
				characterRadius: 3,
			},
			saw
		)
		// Stop ticker to prevent concurrent simulation during test
		game.ticker.stop()

		await game.loaded

		// Scripts are loaded by default in Game population via scriptsContext
		for (const char of game.population) {
			void char.scriptsContext
		}

		const woodStorage = game.hex.getTile({ q: 16, r: -8 })?.content
		const plankStorage = game.hex.getTile({ q: 17, r: -8 })?.content
		const sawmill = game.hex.getTile({ q: 18, r: -8 })?.content
		const stockOf = (content: unknown, goodType: string) =>
			((content as any)?.storage?.stock?.[goodType] ?? 0) as number
		const plankCount = () =>
			stockOf(plankStorage, 'planks') + stockOf(sawmill, 'planks')
		const timeline: string[] = []

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
			errorFound = true
			// Still log but avoid circularity by not passing the full mg object
			const safeArgs = args.map((a) => (typeof a === 'object' && a !== null ? '[Object]' : a))
			originalError(...safeArgs)
		}

		try {
			// Bounded day-long regression simulation
			const dt = 0.2
			for (let i = 0; i < 600; i++) {
				game.ticker.update(dt * 1000)
				if (i % 10 === 0) {
					await new Promise((resolve) => setTimeout(resolve, 0))
				}
				if (i % 25 === 0 || plankCount() > 0) {
					if (timeline.length >= 40) timeline.shift()
					const actions = Array.from(game.population)
						.map((char: any) => char.actionDescription?.join('/') || 'none')
						.join(',')
					timeline.push(
						[
							`tick=${i}`,
							`t=${game.clock.virtualTime.toFixed(1)}`,
							`woodStorage=${stockOf(woodStorage, 'wood')}`,
							`sawmillWood=${stockOf(sawmill, 'wood')}`,
							`sawmillPlanks=${stockOf(sawmill, 'planks')}`,
							`plankStorage=${stockOf(plankStorage, 'planks')}`,
							`action=${actions}`,
						].join(' ')
					)
				}
				if (errorFound) break
				if (plankCount() > 0) break
			}
		} finally {
			console.error = originalError
			game.destroy()
		}

		expect(errorFound).toBe(false)
		expect(plankCount(), timeline.join('\n')).toBeGreaterThan(0)
	})
})
