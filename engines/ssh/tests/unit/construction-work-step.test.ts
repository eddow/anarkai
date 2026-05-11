import { alveoli } from 'engine-rules'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { isConstructionSiteShell } from 'ssh/build-site'
import { queryConstructionSiteView } from 'ssh/construction'
import { createConstructionShell, finalizeConstructionShell } from 'ssh/construction-shell'
import { createConstructionSiteState } from 'ssh/construction-state'
import { Game } from 'ssh/game/game'
import { BuildAlveolus } from 'ssh/hive/build'
import { StorageAlveolus } from 'ssh/hive/storage'
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

	it('creates construction shells from construction-site targets', () => {
		const tileB = game.hex.getTile({ q: 1, r: 0 })!

		const alveolusShell = createConstructionShell(
			tileB,
			createConstructionSiteState({ kind: 'alveolus', alveolusType: 'storage' })
		)
		expect(isConstructionSiteShell(alveolusShell)).toBe(true)
		expect(alveolusShell).toBeInstanceOf(BuildAlveolus)
		expect(alveolusShell.constructionSite.target).toEqual({
			kind: 'alveolus',
			alveolusType: 'storage',
		})

		const dwellingShell = createConstructionShell(
			tileB,
			createConstructionSiteState({ kind: 'dwelling', tier: 'basic_dwelling' })
		)
		expect(isConstructionSiteShell(dwellingShell)).toBe(true)
		expect(dwellingShell).toBeInstanceOf(BuildDwelling)
		expect(dwellingShell.constructionSite.target).toEqual({
			kind: 'dwelling',
			tier: 'basic_dwelling',
		})
	})

	it('finalizes construction shells from their construction-site targets', () => {
		game.upsertTerrainOverride = vi.fn() as never
		const tileB = game.hex.getTile({ q: 1, r: 0 })!

		const alveolusShell = createConstructionShell(
			tileB,
			createConstructionSiteState({ kind: 'alveolus', alveolusType: 'storage' })
		)
		tileB.content = alveolusShell
		finalizeConstructionShell(alveolusShell)
		expect(tileB.content).toBeInstanceOf(StorageAlveolus)

		const dwellingShell = createConstructionShell(
			tileB,
			createConstructionSiteState({ kind: 'dwelling', tier: 'basic_dwelling' })
		)
		tileB.content = dwellingShell
		finalizeConstructionShell(dwellingShell)
		expect(tileB.content?.name).toBe('basic_dwelling')
	})

	it('leaves a finalized alveolus shell inert for stale worker assignment lookups', () => {
		game.upsertTerrainOverride = vi.fn() as never
		const tileB = game.hex.getTile({ q: 1, r: 0 })!
		const shell = createConstructionShell(
			tileB,
			createConstructionSiteState({ kind: 'alveolus', alveolusType: 'tree_chopper' })
		)
		tileB.content = shell
		const worker = game.population.createCharacter('Builder', { q: 1, r: 0 })
		if (!(shell instanceof BuildAlveolus)) throw new Error('expected BuildAlveolus shell')
		shell.assignedWorker = worker
		worker.assignedAlveolus = shell

		finalizeConstructionShell(shell)

		expect(worker.assignedAlveolus).toBeUndefined()
		expect(shell.destroyed).toBe(true)
		expect(() => shell.getJob(worker)).not.toThrow()
		expect(shell.getJob(worker)).toBeUndefined()
		expect(shell.aGoodMovement).toBeUndefined()
		expect(shell.incomingGoods).toBe(false)
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
		step.cancel('test.cancel')
		expect(site.constructionWorkSecondsApplied).toBeGreaterThan(0)
		expect(site.constructionWorkSecondsApplied).toBeLessThan(duration)
		expect(site.constructionSite.phase).toBe('waiting_construction')
	})

	it('lays concrete when the foundation step completes for an alveolus project', () => {
		game.upsertTerrainOverride = vi.fn() as never

		const tileB = game.hex.getTile({ q: 1, r: 0 })!
		const land = tileB.content
		expect(land).toBeInstanceOf(UnBuiltLand)
		if (!(land instanceof UnBuiltLand)) return
		land.terrain = 'forest'
		tileB.baseTerrain = 'forest'
		tileB.terrainState = { ...(tileB.terrainState ?? {}), terrain: 'forest' }
		land.setProject('build:storage')
		expect(tileB.baseTerrain).toBe('forest')

		const char = game.population.createCharacter('Builder', { q: 1, r: 0 })
		const wf = new WorkFunctions()
		Object.assign(wf, { [subject]: char })

		const step = wf.foundationStep() as DurationStep
		expect(step).toBeInstanceOf(DurationStep)
		step.tick(step.duration)
		expect(tileB.baseTerrain).toBe('concrete')
		expect(tileB.terrainState?.terrain).toBe('concrete')
		expect(game.upsertTerrainOverride).toHaveBeenCalledWith(
			expect.objectContaining({ q: 1, r: 0 }),
			{ terrain: 'concrete' }
		)
		expect(tileB.content).toBeInstanceOf(BuildAlveolus)
	})

	it('foundation concrete invalidates only the changed terrain sample and one hard terrain refresh', () => {
		const terrainProvider = (game as any).terrainProvider as {
			invalidateCoord(coord: { q: number; r: number }): void
			invalidateAll(): void
		}
		const invalidateCoord = vi.spyOn(terrainProvider, 'invalidateCoord')
		const invalidateAll = vi.spyOn(terrainProvider, 'invalidateAll')
		const invalidateTerrainHard = vi.fn()
		game.renderer = {
			invalidateTerrainHard,
			invalidateTerrain: vi.fn(),
		} as any

		const tileB = game.hex.getTile({ q: 1, r: 0 })!
		const land = tileB.content
		expect(land).toBeInstanceOf(UnBuiltLand)
		if (!(land instanceof UnBuiltLand)) return
		land.terrain = 'forest'
		tileB.baseTerrain = 'forest'
		tileB.terrainState = { ...(tileB.terrainState ?? {}), terrain: 'forest' }
		land.setProject('build:storage')

		const char = game.population.createCharacter('Builder', { q: 1, r: 0 })
		const wf = new WorkFunctions()
		Object.assign(wf, { [subject]: char })

		const step = wf.foundationStep() as DurationStep
		expect(step).toBeInstanceOf(DurationStep)
		step.tick(step.duration)

		expect(invalidateCoord).toHaveBeenCalledWith(expect.objectContaining({ q: 1, r: 0 }))
		expect(invalidateAll).not.toHaveBeenCalled()
		expect(invalidateTerrainHard).toHaveBeenCalledTimes(1)
		expect(invalidateTerrainHard).toHaveBeenCalledWith(expect.objectContaining({ q: 1, r: 0 }))
	})

	it('does not start a foundation step while the project tile is burdened', () => {
		game.upsertTerrainOverride = vi.fn() as never

		const tileB = game.hex.getTile({ q: 1, r: 0 })!
		const land = tileB.content
		expect(land).toBeInstanceOf(UnBuiltLand)
		if (!(land instanceof UnBuiltLand)) return
		land.setProject('build:storage')
		game.hex.looseGoods.add(tileB, 'stone', { position: tileB.position })

		const char = game.population.createCharacter('Builder', { q: 1, r: 0 })
		const wf = new WorkFunctions()
		Object.assign(wf, { [subject]: char })

		expect(wf.foundationStep()).toBeUndefined()
		expect(tileB.content).toBe(land)
		expect(game.upsertTerrainOverride).not.toHaveBeenCalled()
	})

	it('finalizes the target alveolus when the remaining work finishes', () => {
		game.upsertTerrainOverride = vi.fn() as never

		const tileB = game.hex.getTile({ q: 1, r: 0 })!
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
		expect(tileB.content).toBeInstanceOf(StorageAlveolus)
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
