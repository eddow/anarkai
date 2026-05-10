import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { dorm } from 'ssh/game/exampleGames'
import { Game } from 'ssh/game/game'
import { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import { BuildAlveolus } from 'ssh/hive/build'
import { EngineerAlveolus } from 'ssh/hive/engineer'
import { StorageAlveolus } from 'ssh/hive/storage'
import { WorkFunctions } from 'ssh/npcs/context/work'
import { subject } from 'ssh/npcs/scripts'
import { DurationStep } from 'ssh/npcs/steps'
import { residentialBasicDwellingProject } from 'ssh/residential/constants'
import { trySpawnResidentialProject } from 'ssh/residential/demand'
import type { GoodType } from 'ssh/types/base'
import { afterEach, describe, expect, it } from 'vitest'

describe('dorm example game', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	function buildCurrentResidentialProject(storage: StorageAlveolus): void {
		const tile = [...game.hex.tiles].find((candidate) => {
			const content = candidate.content
			return content instanceof UnBuiltLand && content.project === residentialBasicDwellingProject
		})
		expect(tile).toBeDefined()
		if (!tile) return

		const builder = game.population.createCharacter(`Builder ${tile.uid}`, tile.position)
		const work = new WorkFunctions()
		Object.assign(work, { [subject]: builder })

		const foundation = work.foundationStep() as DurationStep
		expect(foundation).toBeInstanceOf(DurationStep)
		foundation.tick(foundation.duration)
		expect(tile.content).toBeInstanceOf(BuildDwelling)
		if (!(tile.content instanceof BuildDwelling)) return

		for (const [good, qty] of Object.entries(tile.content.requiredGoods)) {
			const goodType = good as GoodType
			const quantity = qty ?? 0
			expect(storage.storage.available(goodType)).toBeGreaterThanOrEqual(quantity)
			storage.storage.removeGood(goodType, quantity)
			tile.content.storage.addGood(goodType, quantity)
		}

		const construction = work.constructionStep() as DurationStep
		expect(construction).toBeInstanceOf(DurationStep)
		construction.tick(construction.duration)
		expect(tile.content).toBeInstanceOf(BasicDwelling)
	}

	it('contains the residential construction hive and can build both zoned dwellings', async () => {
		game = new Game({ terrainSeed: 867, characterCount: 0 }, dorm)
		await game.loaded
		game.ticker.stop()

		const storage = game.hex.getTile({ q: 0, r: 0 })?.content
		const engineer = game.hex.getTile({ q: 1, r: 0 })?.content
		const bay = game.hex.getTile({ q: 0, r: 1 })?.content
		const chopperSite = game.hex.getTile({ q: 0, r: -1 })?.content
		expect(storage).toBeInstanceOf(StorageAlveolus)
		expect(engineer).toBeInstanceOf(EngineerAlveolus)
		expect(bay).toBeInstanceOf(FreightBayAlveolus)
		expect(chopperSite).toBeInstanceOf(BuildAlveolus)
		if (!(storage instanceof StorageAlveolus)) return
		if (!(chopperSite instanceof BuildAlveolus)) return

		expect(storage.storage.available('wood')).toBeGreaterThanOrEqual(4)
		expect(storage.storage.available('planks')).toBeGreaterThanOrEqual(2)
		expect(storage.storage.available('stone')).toBeGreaterThan(0)
		expect(chopperSite.target).toBe('tree_chopper')
		expect(chopperSite.requiredGoods.stone).toBeGreaterThan(0)
		expect(chopperSite.remainingNeeds.stone).toBe(chopperSite.requiredGoods.stone)
		expect(
			(chopperSite.advertisedNeeds.stone ?? 0) + chopperSite.storage.allocated('stone')
		).toBeGreaterThan(0)
		expect(
			(chopperSite.hive as unknown as { activeMovements: Set<unknown> }).activeMovements.size
		).toBeGreaterThan(0)
		expect(game.freightLines.map((line) => line.id)).toEqual(
			expect.arrayContaining(['Dorm:implicit-gather:0,1', 'Dorm:distribute:0,1'])
		)
		expect(game.freightLines.filter((line) => line.id.includes('gather'))).toHaveLength(1)

		const burdened = game.hex.getTile({ q: 3, r: 0 })!
		const clear = game.hex.getTile({ q: 4, r: 0 })!
		expect(burdened.zone).toBe('residential')
		expect(clear.zone).toBe('residential')
		expect(burdened.isBurdened).toBe(true)
		expect(clear.isBurdened).toBe(false)

		game.population.createCharacter('Dorm A', { q: 2, r: 0 })
		game.population.createCharacter('Dorm B', { q: 2, r: 1 })

		trySpawnResidentialProject(game)
		expect((clear.content as UnBuiltLand).project).toBe(residentialBasicDwellingProject)
		buildCurrentResidentialProject(storage)

		for (const loose of [...burdened.looseGoods]) loose.remove()
		expect(burdened.isBurdened).toBe(false)
		trySpawnResidentialProject(game)
		expect((burdened.content as UnBuiltLand).project).toBe(residentialBasicDwellingProject)
		buildCurrentResidentialProject(storage)

		expect(clear.content).toBeInstanceOf(BasicDwelling)
		expect(burdened.content).toBeInstanceOf(BasicDwelling)
	})
})
