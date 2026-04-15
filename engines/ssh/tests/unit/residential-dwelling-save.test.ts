import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { Game } from 'ssh/game/game'
import { afterEach, describe, expect, it } from 'vitest'

describe('Dwelling save/load', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('round-trips an under-construction dwelling shell', async () => {
		const gen = { terrainSeed: 90, characterCount: 0 }
		const patches = {
			tiles: [{ coord: [0, 0], terrain: 'grass' }],
			dwellings: [
				{
					coord: [0, 0] as const,
					tier: 'basic_dwelling' as const,
					underConstruction: true,
					constructionPhase: 'waiting_construction' as const,
					constructionWorkSecondsApplied: 1.5,
					goods: { wood: 2, planks: 1 },
				},
			],
		}
		game = new Game(gen, patches)
		await game.loaded
		game.ticker.stop()

		const tile = game.hex.getTile({ q: 0, r: 0 })!
		expect(tile.content).toBeInstanceOf(BuildDwelling)

		const state = game.saveGameData()
		expect(state.dwellings?.some((d) => d.underConstruction)).toBe(true)

		game.destroy()

		const game2 = new Game(gen)
		await game2.loadGameData(state)
		game2.ticker.stop()
		game = game2

		const after = game.hex.getTile({ q: 0, r: 0 })!.content
		expect(after).toBeInstanceOf(BuildDwelling)
		if (!(after instanceof BuildDwelling)) return
		expect(after.constructionWorkSecondsApplied).toBe(1.5)
		expect(after.constructionSite.phase).toBe('waiting_construction')
	})

	it('round-trips a completed basic dwelling', async () => {
		const gen = { terrainSeed: 91, characterCount: 0 }
		const patches = {
			tiles: [{ coord: [0, 0], terrain: 'grass' }],
			dwellings: [{ coord: [0, 0] as const, tier: 'basic_dwelling' as const }],
		}
		game = new Game(gen, patches)
		await game.loaded
		game.ticker.stop()

		expect(game.hex.getTile({ q: 0, r: 0 })?.content).toBeInstanceOf(BasicDwelling)

		const state = game.saveGameData()
		game.destroy()

		const game2 = new Game(gen)
		await game2.loadGameData(state)
		game2.ticker.stop()
		game = game2

		expect(game.hex.getTile({ q: 0, r: 0 })?.content).toBeInstanceOf(BasicDwelling)
	})
})
