import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { Game } from 'ssh/game/game'
import { residentialBasicDwellingProject } from 'ssh/residential/constants'
import { trySpawnResidentialProject } from 'ssh/residential/demand'
import { afterEach, describe, expect, it } from 'vitest'

describe('trySpawnResidentialProject', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('does not start a project when housing pressure is non-positive', async () => {
		game = new Game(
			{ terrainSeed: 77, characterCount: 0 },
			{
				tiles: [{ coord: [0, 0], terrain: 'grass' }],
				zones: { residential: [[0, 0]] },
			}
		)
		await game.loaded
		game.ticker.stop()

		trySpawnResidentialProject(game)
		const tile = game.hex.getTile({ q: 0, r: 0 })!
		const land = tile.content
		expect(land).toBeInstanceOf(UnBuiltLand)
		if (!(land instanceof UnBuiltLand)) return
		expect(land.project).toBeUndefined()
	})

	it('starts a basic dwelling project on a clear residential tile when pressure is positive', async () => {
		game = new Game(
			{ terrainSeed: 78, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0], terrain: 'grass' },
					{ coord: [1, 0], terrain: 'grass' },
				],
				zones: {
					residential: [
						[0, 0],
						[1, 0],
					],
				},
			}
		)
		await game.loaded
		game.ticker.stop()

		game.population.createCharacter('A', { q: 0, r: 0 })
		game.population.createCharacter('B', { q: 1, r: 0 })

		trySpawnResidentialProject(game)

		const tile0 = game.hex.getTile({ q: 0, r: 0 })!
		const land0 = tile0.content
		expect(land0).toBeInstanceOf(UnBuiltLand)
		if (!(land0 instanceof UnBuiltLand)) return
		expect(land0.project).toBe(residentialBasicDwellingProject)

		const tile1 = game.hex.getTile({ q: 1, r: 0 })!
		const land1 = tile1.content
		expect(land1).toBeInstanceOf(UnBuiltLand)
		if (!(land1 instanceof UnBuiltLand)) return
		expect(land1.project).toBeUndefined()
	})
})
