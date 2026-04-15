import { alveoli } from 'engine-rules'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { queryConstructionSiteView } from 'ssh/construction'
import { Game } from 'ssh/game/game'
import { alveolusClass } from 'ssh/hive'
import { BuildAlveolus } from 'ssh/hive/build'
import { WorkFunctions } from 'ssh/npcs/context/work'
import { subject } from 'ssh/npcs/scripts'
import { DurationStep } from 'ssh/npcs/steps'
import type { GoodType } from 'ssh/types/base'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('constructionStep resumable work', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	beforeEach(async () => {
		game = new Game(
			{ terrainSeed: 44, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0], terrain: 'concrete' },
					{ coord: [1, 0], terrain: 'concrete' },
				],
				hives: [
					{
						name: 'WorkHive',
						alveoli: [{ coord: [0, 0], alveolus: 'engineer' }],
					},
				],
			}
		)
		await game.loaded
		game.ticker.stop()
	})

	it('credits partial seconds when the duration step is canceled mid-way', () => {
		const tileB = game.hex.getTile({ q: 1, r: 0 })!
		const site = new BuildAlveolus(tileB, 'engineer')
		site.storage.addGood('wood', 1)
		site.storage.addGood('stone', 1)
		tileB.content = site

		const char = game.population.createCharacter('Builder', { q: 1, r: 0 })

		const wf = new WorkFunctions()
		Object.assign(wf, { [subject]: char })

		const step = wf.constructionStep() as DurationStep
		expect(step).toBeInstanceOf(DurationStep)
		expect(site.constructionSite.phase).toBe('building')
		const duration = step.duration
		step.tick(duration / 2)
		const liveView = queryConstructionSiteView(game, tileB)
		expect(liveView?.phase).toBe('building')
		expect(liveView?.constructionWorkSecondsApplied).toBeGreaterThan(0)
		expect(liveView?.constructionWorkSecondsApplied).toBeLessThan(duration)
		step.cancel()
		expect(site.constructionWorkSecondsApplied).toBeGreaterThan(0)
		expect(site.constructionWorkSecondsApplied).toBeLessThan(duration)
		expect(site.constructionSite.phase).toBe('waiting_construction')
	})

	it('finalizes the target alveolus when the remaining work finishes', () => {
		game.upsertTerrainOverride = vi.fn() as never

		const tileB = game.hex.getTile({ q: 1, r: 0 })!
		const StorageCtor = alveolusClass.storage
		if (!StorageCtor) throw new Error('storage class missing')

		const site = new BuildAlveolus(tileB, 'storage')
		const required = alveoli.storage.construction?.goods ?? {}
		for (const [good, qty] of Object.entries(required)) {
			site.storage.addGood(good as GoodType, qty)
		}
		const total = alveoli.storage.construction?.time ?? 0
		expect(total).toBeGreaterThan(0)
		site.constructionWorkSecondsApplied = total - 1
		tileB.content = site

		const char = game.population.createCharacter('Builder', { q: 1, r: 0 })

		const wf = new WorkFunctions()
		Object.assign(wf, { [subject]: char })

		const step = wf.constructionStep() as DurationStep
		expect(step).toBeInstanceOf(DurationStep)
		step.tick(step.duration)
		expect(tileB.content).toBeInstanceOf(StorageCtor)
		expect(tileB.content).not.toBeInstanceOf(BuildAlveolus)
	})

	it('finalizes a dwelling build shell into a basic dwelling when work finishes', () => {
		game.upsertTerrainOverride = vi.fn() as never

		const tileB = game.hex.getTile({ q: 1, r: 0 })!
		const site = new BuildDwelling(tileB, 'basic_dwelling')
		site.storage.addGood('wood', 2)
		site.storage.addGood('planks', 1)
		const total = site.constructionSite.recipe.workSeconds
		expect(total).toBeGreaterThan(0)
		site.constructionWorkSecondsApplied = total - 0.25
		tileB.content = site

		const char = game.population.createCharacter('Builder', { q: 1, r: 0 })

		const wf = new WorkFunctions()
		Object.assign(wf, { [subject]: char })

		const step = wf.constructionStep() as DurationStep
		expect(step).toBeInstanceOf(DurationStep)
		step.tick(step.duration)
		expect(tileB.content?.name).toBe('basic_dwelling')
		expect(tileB.content).not.toBeInstanceOf(BuildDwelling)
	})
})
