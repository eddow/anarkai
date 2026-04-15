import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { Game } from 'ssh/game/game'
import { EngineerAlveolus } from 'ssh/hive/engineer'
import { residentialBasicDwellingProject } from 'ssh/residential/constants'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('EngineerAlveolus.nextJob residential construction priority', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	beforeEach(async () => {
		game = new Game(
			{ terrainSeed: 91, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0], terrain: 'concrete' },
					{ coord: [1, 0], terrain: 'concrete' },
					{ coord: [2, 0], terrain: 'concrete' },
					{ coord: [3, 0], terrain: 'concrete' },
					{ coord: [4, 0], terrain: 'concrete' },
					{ coord: [5, 0], terrain: 'concrete' },
				],
				hives: [
					{
						name: 'EngHive',
						alveoli: [{ coord: [0, 0], alveolus: 'engineer' }],
					},
				],
			}
		)
		await game.loaded
		game.ticker.stop()
	})

	it('prefers a farther ready BuildDwelling over a nearer residential foundation site', () => {
		const tileNear = game.hex.getTile({ q: 1, r: 0 })!
		tileNear.zone = 'residential'
		const nearLand = tileNear.content
		expect(nearLand).toBeInstanceOf(UnBuiltLand)
		if (!(nearLand instanceof UnBuiltLand)) return
		nearLand.setProject(residentialBasicDwellingProject)

		const tileFar = game.hex.getTile({ q: 5, r: 0 })!
		tileFar.zone = 'residential'
		const farSite = new BuildDwelling(tileFar, 'basic_dwelling')
		farSite.storage.addGood('wood', 2)
		farSite.storage.addGood('planks', 1)
		tileFar.content = farSite

		const engineerTile = game.hex.getTile({ q: 0, r: 0 })!
		const engineer = engineerTile.content
		expect(engineer).toBeInstanceOf(EngineerAlveolus)
		if (!(engineer instanceof EngineerAlveolus)) return

		const character = game.population.createCharacter('Eng', { q: 0, r: 0 })
		const job = engineer.nextJob(character)

		expect(job?.job).toBe('construct')
		const terminal = job?.path?.[job.path.length - 1]
		expect(terminal).toMatchObject({ q: 5, r: 0 })
	})

	it('falls back to foundation when no ready construction shell exists', () => {
		const tileNear = game.hex.getTile({ q: 1, r: 0 })!
		tileNear.zone = 'residential'
		const nearLand = tileNear.content
		expect(nearLand).toBeInstanceOf(UnBuiltLand)
		if (!(nearLand instanceof UnBuiltLand)) return
		nearLand.setProject(residentialBasicDwellingProject)

		const engineerTile = game.hex.getTile({ q: 0, r: 0 })!
		const engineer = engineerTile.content
		expect(engineer).toBeInstanceOf(EngineerAlveolus)
		if (!(engineer instanceof EngineerAlveolus)) return

		const character = game.population.createCharacter('Eng', { q: 0, r: 0 })
		const job = engineer.nextJob(character)

		expect(job?.job).toBe('foundation')
		const terminal = job?.path?.[job.path.length - 1]
		expect(terminal).toMatchObject({ q: 1, r: 0 })
	})
})
