import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { computeNetDeficitLedger } from 'ssh/commerce/deficit-ledger'
import { dorm } from 'ssh/game/exampleGames'
import { Game } from 'ssh/game/game'
import { BuildAlveolus } from 'ssh/hive/build'
import { residentialBasicDwellingProject } from 'ssh/residential/constants'
import { trySpawnResidentialProject } from 'ssh/residential/demand'
import { afterEach, describe, expect, it } from 'vitest'

describe('computeNetDeficitLedger', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('aggregates shell + foundation demand, and drops delivered foundations', async () => {
		game = new Game({ terrainSeed: 867, characterCount: 0 }, dorm)
		await game.loaded
		game.ticker.stop()

		// The dorm example includes a tree_chopper construction shell.
		const chopper = [...game.hex.tiles].find(
			(tile) => tile.content instanceof BuildAlveolus
		)?.content
		expect(chopper).toBeInstanceOf(BuildAlveolus)
		if (!(chopper instanceof BuildAlveolus)) return

		// Spawn a residential project so a foundation (concrete) demand exists.
		game.population.createCharacter('Dorm A', { q: 2, r: 0 })
		game.population.createCharacter('Dorm B', { q: 2, r: 1 })
		trySpawnResidentialProject(game)

		// The pure function and the Game accessor agree (accessor computes on demand).
		const first = game.netDeficitLedger
		expect(computeNetDeficitLedger(game.hex.tiles)).toEqual(first)

		// tree_chopper shell needs stone; its own source is the origin.
		expect(first.stone).toBeDefined()
		expect(first.stone!.demand).toBeGreaterThan(0)
		expect(first.stone!.needs.some((need) => need.source === chopper)).toBe(true)

		// residential foundation needs concrete; the source is an UnBuiltLand.
		expect(first.concrete).toBeDefined()
		expect(first.concrete!.demand).toBeGreaterThan(0)
		expect(first.concrete!.needs.some((need) => need.source instanceof UnBuiltLand)).toBe(true)

		// Deliver the concrete; the foundation need disappears from the ledger.
		const land = [...game.hex.tiles]
			.map((tile) => tile.content)
			.find(
				(content): content is UnBuiltLand =>
					content instanceof UnBuiltLand && content.project === residentialBasicDwellingProject
			)
		expect(land).toBeDefined()
		if (!land) return
		land.foundationStorage?.addGood('concrete', 1)

		const second = game.netDeficitLedger
		expect(second.concrete).toBeUndefined()
		expect(second.stone?.demand).toBe(first.stone!.demand)
	}, 15000)
})
