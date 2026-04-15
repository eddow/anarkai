import { Game } from 'ssh/game/game'
import { BuildAlveolus } from 'ssh/hive/build'
import { afterEach, describe, expect, it } from 'vitest'

describe('BuildAlveolus save/load', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('round-trips underConstruction patch and construction work seconds', async () => {
		const gen = { terrainSeed: 55, characterCount: 0 }
		const patches = {
			tiles: [
				{ coord: [0, 0], terrain: 'concrete' },
				{ coord: [1, 0], terrain: 'concrete' },
			],
			hives: [
				{
					name: 'PersistHive',
					alveoli: [
						{ coord: [0, 0], alveolus: 'engineer' as const },
						{
							coord: [1, 0],
							alveolus: 'storage' as const,
							underConstruction: true,
							constructionPhase: 'building' as const,
							constructionWorkSecondsApplied: 2.25,
							goods: { wood: 1 },
						},
					],
				},
			],
		}
		game = new Game(gen, patches)
		await game.loaded
		game.ticker.stop()

		const tile = game.hex.getTile({ q: 1, r: 0 })!
		const before = tile.content
		expect(before).toBeInstanceOf(BuildAlveolus)
		if (!(before instanceof BuildAlveolus)) return
		expect(before.constructionWorkSecondsApplied).toBe(2.25)
		expect(before.constructionSite.phase).toBe('building')

		const state = game.saveGameData()
		const hiveEntry = state.hives?.find((h) => h.name === 'PersistHive')
		expect(hiveEntry?.alveoli.some((a) => a.underConstruction === true)).toBe(true)
		expect(hiveEntry?.alveoli.find((a) => a.underConstruction)?.constructionPhase).toBe('building')

		game.destroy()

		const game2 = new Game(gen)
		await game2.loadGameData(state)
		game2.ticker.stop()
		game = game2

		const after = game.hex.getTile({ q: 1, r: 0 })!.content
		expect(after).toBeInstanceOf(BuildAlveolus)
		if (!(after instanceof BuildAlveolus)) return
		expect(after.target).toBe('storage')
		expect(after.constructionWorkSecondsApplied).toBe(2.25)
		expect(after.constructionSite.phase).toBe('building')
	})
})
