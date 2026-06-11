import { chopSaw } from 'ssh/game/exampleGames'
import { Game } from 'ssh/game/game'
import { BuildAlveolus } from 'ssh/hive/build'
import { StorageAlveolus } from 'ssh/hive/storage'
import { SpecificStorage } from 'ssh/storage/specific-storage'
import { afterEach, describe, expect, it } from 'vitest'

describe('BuildAlveolus save/load', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('loads legacy hive construction and saves it as an exterior project site', async () => {
		const gen = { terrainSeed: 55, characterCount: 0 }
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'concrete' as const },
				{ coord: [1, 0] as const, terrain: 'concrete' as const },
			],
			hives: [
				{
					name: 'PersistHive',
					alveoli: [
						{ coord: [0, 0] as const, alveolus: 'engineer' as const },
						{
							coord: [1, 0] as const,
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
		expect(hiveEntry?.alveoli.some((a) => a.underConstruction === true)).toBe(false)
		const projectSite = state.projectSites?.find(
			(site) => site.coord[0] === 1 && site.coord[1] === 0
		)
		expect(projectSite).toMatchObject({
			project: 'build:storage',
			constructionPhase: 'building',
			constructionWorkSecondsApplied: 2.25,
			constructionGoods: { wood: 1 },
		})

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

	it('loads and saves pile variant configuration from patches', async () => {
		const gen = { terrainSeed: 549, characterCount: 0 }
		game = new Game(gen, chopSaw)
		await game.loaded
		game.ticker.stop()

		const pileCoord = { q: 0, r: -1 }
		const pile = game.hex.getTile(pileCoord)?.content
		expect(pile).toBeInstanceOf(StorageAlveolus)
		if (!(pile instanceof StorageAlveolus)) return
		expect(pile.alveolusType).toBe('pile')
		expect(pile.variant).toBe('planks')
		expect(pile.storage).toBeInstanceOf(SpecificStorage)
		expect(pile.storage.maxAmounts.planks).toBe(24)

		const state = game.saveGameData()
		const hiveEntry = state.hives?.find((h) => h.name === 'ChopSaw')
		const pilePatch = hiveEntry?.alveoli.find(
			(a) => a.coord[0] === pileCoord.q && a.coord[1] === pileCoord.r
		)
		expect(pilePatch?.alveolus).toBe('pile')
		expect(pilePatch?.variant).toBe('planks')

		game.destroy()

		const game2 = new Game(gen)
		await game2.loadGameData(state)
		game2.ticker.stop()
		game = game2

		const restored = game.hex.getTile(pileCoord)?.content
		expect(restored).toBeInstanceOf(StorageAlveolus)
		if (!(restored instanceof StorageAlveolus)) return
		expect(restored.alveolusType).toBe('pile')
		expect(restored.variant).toBe('planks')
		expect(restored.storage).toBeInstanceOf(SpecificStorage)
		expect(restored.storage.maxAmounts.planks).toBe(24)
	})
})
