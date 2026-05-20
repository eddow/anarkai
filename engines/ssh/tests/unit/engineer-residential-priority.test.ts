import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { Game } from 'ssh/game/game'
import { EngineerAlveolus } from 'ssh/hive/engineer'
import type { ScriptExecution } from 'ssh/npcs/scripts'
import { residentialBasicDwellingProject } from 'ssh/residential/constants'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('EngineerAlveolus.nextJob residential construction priority', () => {
	let game: Game

	function clearGeneratedBurden(coord: { q: number; r: number }) {
		const tile = game.hex.getTile(coord)
		const content = tile?.content
		if (content instanceof UnBuiltLand) content.deposit = undefined
		for (const good of [...(tile?.looseGoods ?? [])]) good.remove()
	}

	function makeReadyResidentialFoundation(land: UnBuiltLand) {
		land.setProject(residentialBasicDwellingProject)
		land.foundationStorage?.addGood('concrete', 1)
	}

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
			for (let q = 1; q <= 5; q++) clearGeneratedBurden({ q, r: 0 })
		})

	it('prefers a farther ready BuildDwelling over a nearer residential foundation site', () => {
		const tileNear = game.hex.getTile({ q: 1, r: 0 })!
		tileNear.zone = 'residential'
		const nearLand = tileNear.content
		expect(nearLand).toBeInstanceOf(UnBuiltLand)
		if (!(nearLand instanceof UnBuiltLand)) return
			makeReadyResidentialFoundation(nearLand)

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
			makeReadyResidentialFoundation(nearLand)

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

	it('lists nearby engineering targets independently from the asking character', () => {
		const tileNear = game.hex.getTile({ q: 1, r: 0 })!
		tileNear.zone = 'residential'
		const nearLand = tileNear.content
		expect(nearLand).toBeInstanceOf(UnBuiltLand)
		if (!(nearLand instanceof UnBuiltLand)) return
			makeReadyResidentialFoundation(nearLand)

		const tileFar = game.hex.getTile({ q: 5, r: 0 })!
		tileFar.zone = 'residential'
		const farSite = new BuildDwelling(tileFar, 'basic_dwelling')
		farSite.storage.addGood('wood', 2)
		farSite.storage.addGood('planks', 1)
		tileFar.content = farSite

		const engineer = game.hex.getTile({ q: 0, r: 0 })?.content
		expect(engineer).toBeInstanceOf(EngineerAlveolus)
		if (!(engineer instanceof EngineerAlveolus)) return

		const proposed = engineer.proposedJobs.map((job) => ({
			job: job.job,
			coord: job.targetTile.position,
		}))
		expect(proposed).toEqual([
			{ job: 'construct', coord: tileFar.position },
			{ job: 'foundation', coord: tileNear.position },
		])

		const character = game.population.createCharacter('Eng', { q: 0, r: 0 })
		expect(engineer.getJob(character)?.path?.at(-1)).toMatchObject({ q: 5, r: 0 })
		character.position = tileFar.position
		;(character as unknown as { _tile: typeof tileFar })._tile = tileFar
		expect(engineer.proposedJobs.map((job) => job.targetTile.position)).toEqual([
			tileFar.position,
			tileNear.position,
		])
		expect(engineer.getJob(character)?.path?.at(-1)).toMatchObject({ q: 5, r: 0 })
	})

	it('does not propose foundation on a vehicle-burdened project tile', () => {
		const tileNear = game.hex.getTile({ q: 1, r: 0 })!
		tileNear.zone = 'residential'
		const nearLand = tileNear.content
		expect(nearLand).toBeInstanceOf(UnBuiltLand)
		if (!(nearLand instanceof UnBuiltLand)) return
			makeReadyResidentialFoundation(nearLand)
		game.vehicles.createVehicle('barrow-on-foundation', 'wheelbarrow', tileNear.position)
		expect(tileNear.isBurdened).toBe(true)

		const engineerTile = game.hex.getTile({ q: 0, r: 0 })!
		const engineer = engineerTile.content
		expect(engineer).toBeInstanceOf(EngineerAlveolus)
		if (!(engineer instanceof EngineerAlveolus)) return

		const character = game.population.createCharacter('Eng', { q: 0, r: 0 })
		const job = engineer.nextJob(character)

		expect(job).toBeUndefined()
	})

	it('refreshes assigned engineer foundation work after the project tile is offloaded', () => {
		const tileNear = game.hex.getTile({ q: 1, r: 0 })!
		tileNear.zone = 'residential'
		const nearLand = tileNear.content
		expect(nearLand).toBeInstanceOf(UnBuiltLand)
		if (!(nearLand instanceof UnBuiltLand)) return
			makeReadyResidentialFoundation(nearLand)
		const loose = game.hex.looseGoods.add(tileNear, 'wood')
		expect(tileNear.isBurdened).toBe(true)
		expect(nearLand.constructionSite?.phase).toBe('planned')

		const engineerTile = game.hex.getTile({ q: 0, r: 0 })!
		const engineer = engineerTile.content
		expect(engineer).toBeInstanceOf(EngineerAlveolus)
		if (!(engineer instanceof EngineerAlveolus)) return

		const character = game.population.createCharacter('Eng', { q: 0, r: 0 })
		engineer.assignedWorker = character
		character.assignedAlveolus = engineer
		expect(engineer.getJob(character)).toBeUndefined()

		loose.remove()

		expect(tileNear.isBurdened).toBe(false)
		expect(nearLand.constructionSite?.phase).toBe('foundation')
		expect(engineer.getJob(character)?.job).toBe('foundation')
		expect(
			character.workPlannerSnapshot?.ranked.some((candidate) => candidate.jobKind === 'foundation')
		).toBe(true)
	})

	it('keeps assigned engineer foundation paths fresh as the worker position changes', () => {
		const tileNear = game.hex.getTile({ q: 1, r: 0 })!
		tileNear.zone = 'residential'
		const nearLand = tileNear.content
		expect(nearLand).toBeInstanceOf(UnBuiltLand)
		if (!(nearLand instanceof UnBuiltLand)) return
			makeReadyResidentialFoundation(nearLand)

		const tileFar = game.hex.getTile({ q: 5, r: 0 })!
		tileFar.zone = 'residential'
		const farLand = tileFar.content
		expect(farLand).toBeInstanceOf(UnBuiltLand)
		if (!(farLand instanceof UnBuiltLand)) return
			makeReadyResidentialFoundation(farLand)

		const engineerTile = game.hex.getTile({ q: 0, r: 0 })!
		const engineer = engineerTile.content
		expect(engineer).toBeInstanceOf(EngineerAlveolus)
		if (!(engineer instanceof EngineerAlveolus)) return

		const character = game.population.createCharacter('Eng', { q: 0, r: 0 })
		engineer.assignedWorker = character
		character.assignedAlveolus = engineer
		const nearJob = engineer.getJob(character)
		expect(nearJob?.job).toBe('foundation')
		expect(nearJob?.path?.at(-1)).toMatchObject({ q: 1, r: 0 })

		character.position = tileFar.position
		;(character as unknown as { _tile: typeof tileFar })._tile = tileFar
		const farJob = engineer.getJob(character)
		expect(farJob?.job).toBe('foundation')
		expect(farJob?.path?.at(-1)).toMatchObject({ q: 5, r: 0 })
	})

	it('continues from prepare into the foundation step when running the real work script', () => {
		const tileNear = game.hex.getTile({ q: 1, r: 0 })!
		tileNear.zone = 'residential'
		const land = tileNear.content
		expect(land).toBeInstanceOf(UnBuiltLand)
		if (!(land instanceof UnBuiltLand)) return
			makeReadyResidentialFoundation(land)

		const character = game.population.createCharacter('Eng', { q: 0, r: 0 })
		const action = character.findAction()
		expect(action).toBeDefined()
		character.begin(action as ScriptExecution)

		expect(character.stepExecutor?.description).toBe('prepare.foundation')
		character.update(1)

		expect(character.stepExecutor?.description).not.toBe('prepare.foundation')
		expect(tileNear.content).toBe(land)
		for (let i = 0; i < 80 && !(tileNear.content instanceof BuildDwelling); i++) {
			character.update(0.25)
		}

		expect(tileNear.content).toBeInstanceOf(BuildDwelling)
	})
})
