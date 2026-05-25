import {
	Deposit,
	plantedTreeMatureAgeSeconds,
	plantedTreeMaxPerTile,
	plantedTreeTileFootprint,
	plantedTreeWoodYield,
	tileLooseGoodsCapacity,
	UnBuiltLand,
} from 'ssh/board/content/unbuilt-land'
import type { ForesterAlveolus } from 'ssh/hive/forester'
import type { HarvestAlveolus } from 'ssh/hive/harvest'
import { WorkFunctions } from 'ssh/npcs/context/work'
import { subject } from 'ssh/npcs/scripts'
import { afterEach, describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine/engine'

describe('forester planted trees', () => {
	let engine: TestEngine | undefined

	afterEach(async () => {
		await engine?.destroy()
		engine = undefined
	})

	async function loadForesterScenario(assignedZoneIds: string[] = []) {
		engine = new TestEngine({ terrainSeed: 123, characterCount: 0 })
		await engine.init()
		engine.loadScenario({
			tiles: [
				{ coord: [1, 0], terrain: 'forest' },
				{ coord: [2, 0], terrain: 'forest' },
			],
			hives: [
				{
					name: 'Foresters',
					alveoli: [{ coord: [0, 0], alveolus: 'forester', assignedZoneIds }],
				},
			],
			zones: {
				named: [{ id: 'north-grove', name: 'North Grove', coords: [[1, 0]] }],
			},
			population: [],
		} as never)
		const forester = engine.game.hex.getTile({ q: 0, r: 0 })?.content as ForesterAlveolus
		return { engine, forester }
	}

	it('requires an assigned named zone before proposing planting work', async () => {
		const { forester } = await loadForesterScenario()
		expect(forester.nextJob()?.job).toBeUndefined()
	})

	it('plants only inside assigned named zones and caps tree count to visible slots', async () => {
		const { engine, forester } = await loadForesterScenario(['north-grove'])
		const job = forester.nextJob()
		expect(job?.job).toBe('forester')
		expect(job?.path?.at(-1)).toMatchObject({ q: 1, r: 0 })
		expect(forester.proposedJobs[0]?.targetTile.position).toMatchObject({ q: 1, r: 0 })

		const zoneTile = engine.game.hex.getTile({ q: 1, r: 0 })!
		const outOfZoneTile = engine.game.hex.getTile({ q: 2, r: 0 })!
		const worker = engine.game.population.createCharacter('Planter', zoneTile.position)
		expect(forester.plantAtCurrentTile(worker)).toBe(true)
		expect(forester.plantAtCurrentTile(worker)).toBe(true)
		expect(forester.plantAtCurrentTile(worker)).toBe(false)

		const zoneLand = zoneTile.content as UnBuiltLand
		const outOfZoneLand = outOfZoneTile.content as UnBuiltLand
		expect(zoneLand.deposit?.name).toBe('tree')
		expect(zoneLand.deposit?.amount).toBe(plantedTreeMaxPerTile)
		expect(zoneLand.plantedTrees?.ages).toHaveLength(plantedTreeMaxPerTile)
		expect(outOfZoneLand.deposit).toBeUndefined()
	})

	it('counts loose goods against tree planting room', async () => {
		const { engine, forester } = await loadForesterScenario(['north-grove'])
		const zoneTile = engine.game.hex.getTile({ q: 1, r: 0 })!
		const worker = engine.game.population.createCharacter('Planter', zoneTile.position)

		for (let i = 0; i < plantedTreeTileFootprint; i++) {
			engine.game.hex.looseGoods.add(zoneTile, 'wood')
		}

		expect(forester.nextJob()?.job).toBe('forester')
		expect(forester.plantAtCurrentTile(worker)).toBe(true)
		expect(forester.plantAtCurrentTile(worker)).toBe(false)

		const land = zoneTile.content as UnBuiltLand
		expect(land.deposit?.amount).toBe(1)
		expect(land.plantedTrees?.ages).toHaveLength(1)
	})

	it('does not propose planting jobs where loose goods leave no tree room', async () => {
		const { engine, forester } = await loadForesterScenario(['north-grove'])
		const zoneTile = engine.game.hex.getTile({ q: 1, r: 0 })!
		const worker = engine.game.population.createCharacter('Planter', zoneTile.position)

		for (let i = 0; i < tileLooseGoodsCapacity - plantedTreeTileFootprint + 1; i++) {
			engine.game.hex.looseGoods.add(zoneTile, 'wood')
		}

		expect(forester.nextJob()?.job).toBeUndefined()
		expect(forester.plantAtCurrentTile(worker)).toBe(false)
		expect((zoneTile.content as UnBuiltLand).deposit).toBeUndefined()
	})

	it('advertises planting jobs at the planting tile so workers score their own distance', async () => {
		const { engine, forester } = await loadForesterScenario(['north-grove'])
		const zoneTile = engine.game.hex.getTile({ q: 1, r: 0 })!
		const worker = engine.game.population.createCharacter('Planter', zoneTile.position)

		const match = worker.resolveBestJobMatch()

		expect(match).not.toBe(false)
		expect(match?.job.job).toBe('forester')
		expect(match?.targetTile.position).toMatchObject({ q: 1, r: 0 })
		expect(match?.path).toHaveLength(0)

		worker.assignedAlveolus = forester
		const assignedMatch = worker.resolveBestJobMatch()
		expect(assignedMatch).not.toBe(false)
		expect(assignedMatch?.job.job).toBe('forester')
		expect(assignedMatch?.targetTile.position).toMatchObject({ q: 1, r: 0 })
		expect(assignedMatch?.path).toHaveLength(0)
	})

	it('plants on forest terrain only for now', async () => {
		const { engine, forester } = await loadForesterScenario(['north-grove'])
		const sandTile = engine.game.hex.getTile({ q: 1, r: 0 })!
		engine.game.hex.setTileContent(sandTile, new UnBuiltLand(sandTile, 'sand'))
		const worker = engine.game.population.createCharacter('Planter', sandTile.position)

		expect(forester.plantAtCurrentTile(worker)).toBe(false)
		expect((sandTile.content as UnBuiltLand).deposit).toBeUndefined()
		expect(forester.nextJob()).toBeUndefined()
	})

	it('ages planted trees until they become mature', async () => {
		const { engine, forester } = await loadForesterScenario(['north-grove'])
		const zoneTile = engine.game.hex.getTile({ q: 1, r: 0 })!
		const worker = engine.game.population.createCharacter('Planter', zoneTile.position)
		expect(forester.plantAtCurrentTile(worker)).toBe(true)

		engine.tick(plantedTreeMatureAgeSeconds + 1, plantedTreeMatureAgeSeconds + 1)
		const land = zoneTile.content as UnBuiltLand
		expect(land.plantedTrees?.ages[0]).toBeGreaterThanOrEqual(plantedTreeMatureAgeSeconds)
	})

	it('lets tree choppers harvest mature planted trees for the planted-tree yield', async () => {
		engine = new TestEngine({ terrainSeed: 456, characterCount: 0 })
		await engine.init()
		engine.loadScenario({
			tiles: [
				{
					coord: [0, 0],
					terrain: 'forest',
					deposit: { type: 'tree', amount: 2 },
					plantedTrees: { ages: [plantedTreeMatureAgeSeconds + 1, 0] },
				},
				{ coord: [1, 0], terrain: 'concrete' },
			],
			hives: [{ name: 'Cutters', alveoli: [{ coord: [1, 0], alveolus: 'tree_chopper' }] }],
			population: [],
		} as never)

		const chopper = engine.game.hex.getTile({ q: 1, r: 0 })?.content as HarvestAlveolus
		const worker = engine.game.population.createCharacter('Cutter', { q: 0, r: 0 })
		worker.assignedAlveolus = chopper
		const wf = new WorkFunctions()
		Object.assign(wf, { [subject]: worker })
		const step = wf.harvestStep()
		step?.tick(chopper.workTime)

		const land = engine.game.hex.getTile({ q: 0, r: 0 })?.content as UnBuiltLand
		expect(land.deposit?.amount).toBe(1)
		expect(land.plantedTrees?.ages).toHaveLength(1)
		expect(engine.game.hex.looseGoods.getGoodsAt({ q: 0, r: 0 })).toHaveLength(plantedTreeWoodYield)
	})

	it('keeps immature planted trees out of ordinary chopper jobs', async () => {
		engine = new TestEngine({ terrainSeed: 789, characterCount: 0 })
		await engine.init()
		engine.loadScenario({
			tiles: [
				{
					coord: [0, 0],
					terrain: 'forest',
					deposit: { type: 'tree', amount: 1 },
					plantedTrees: { ages: [0] },
				},
				{ coord: [4, 0], terrain: 'concrete' },
			],
			hives: [{ name: 'Cutters', alveoli: [{ coord: [4, 0], alveolus: 'tree_chopper' }] }],
			population: [],
		} as never)
		const chopper = engine.game.hex.getTile({ q: 4, r: 0 })?.content as HarvestAlveolus
		expect(chopper.nextJob()?.job).toBeUndefined()
	})

	it('preserves legacy tree deposit harvesting', async () => {
		engine = new TestEngine({ terrainSeed: 987, characterCount: 0 })
		await engine.init()
		engine.loadScenario({
			tiles: [
				{ coord: [0, 0], terrain: 'forest', deposit: { type: 'tree', amount: 2 } },
				{ coord: [1, 0], terrain: 'concrete' },
			],
			hives: [{ name: 'Cutters', alveoli: [{ coord: [1, 0], alveolus: 'tree_chopper' }] }],
			zones: { harvest: [[0, 0]] },
			population: [],
		} as never)
		const chopper = engine.game.hex.getTile({ q: 1, r: 0 })?.content as HarvestAlveolus
		expect(chopper.nextJob()?.job).toBe('harvest')
	})

	it('lets wheat planters seed grass and wheat harvesters harvest the crop', async () => {
		engine = new TestEngine({ terrainSeed: 246, characterCount: 0 })
		await engine.init()
		engine.loadScenario({
			tiles: [
				{ coord: [1, 0], terrain: 'grass' },
				{ coord: [0, 0], terrain: 'concrete' },
				{ coord: [2, 0], terrain: 'concrete' },
			],
			hives: [
				{
					name: 'Bread Basket',
					alveoli: [
						{ coord: [0, 0], alveolus: 'wheat_planter', assignedZoneIds: ['field'] },
						{ coord: [2, 0], alveolus: 'wheat_harvester' },
					],
				},
			],
			zones: {
				named: [{ id: 'field', name: 'Field', coords: [[1, 0]] }],
			},
			population: [],
		} as never)
		engine.game.hex.zoneManager.defineZone({ id: 'field', name: 'Field', harvestable: true })

		const planter = engine.game.hex.getTile({ q: 0, r: 0 })?.content as ForesterAlveolus
		const harvester = engine.game.hex.getTile({ q: 2, r: 0 })?.content as HarvestAlveolus
		const fieldTile = engine.game.hex.getTile({ q: 1, r: 0 })!
		const worker = engine.game.population.createCharacter('Planter', fieldTile.position)
		worker.assignedAlveolus = planter

		expect(planter.nextJob()?.job).toBe('forester')
		expect(planter.plantAtCurrentTile(worker)).toBe(true)

		const land = fieldTile.content as UnBuiltLand
		expect(land.deposit?.name).toBe('wheat_crop')
		expect(land.deposit?.amount).toBe(1)
		expect(land.plantedTrees).toBeUndefined()
		expect(harvester.nextJob()?.job).toBe('harvest')
	})

	it('saves and loads forester assignments and planted tree ages', async () => {
		const setup = await loadForesterScenario(['north-grove'])
		const zoneTile = setup.engine.game.hex.getTile({ q: 1, r: 0 })!
		const land = zoneTile.content as UnBuiltLand
		land.deposit = Deposit.create('tree', 1)
		land.plantedTrees = { ages: [plantedTreeMatureAgeSeconds] }
		setup.engine.game.notifyTerrainDepositsChanged(zoneTile)

		const saved = setup.engine.game.saveGameData()
		expect(saved.hives?.[0]?.alveoli[0]?.assignedZoneIds).toEqual(['north-grove'])
		expect(
			saved.tiles?.find((tile) => tile.coord[0] === 1 && tile.coord[1] === 0)?.plantedTrees
		).toEqual({ ages: [plantedTreeMatureAgeSeconds] })
		expect(setup.forester.assignedZoneIds).toEqual(['north-grove'])

		await setup.engine.destroy()
		engine = new TestEngine({ terrainSeed: 123, characterCount: 0 })
		await engine.init()
		engine.loadScenario(saved)
		const restoredForester = engine.game.hex.getTile({ q: 0, r: 0 })?.content as ForesterAlveolus
		const restoredLand = engine.game.hex.getTile({ q: 1, r: 0 })?.content as UnBuiltLand
		expect(restoredForester.assignedZoneIds).toEqual(['north-grove'])
		expect(restoredLand.deposit?.amount).toBe(1)
		expect(restoredLand.plantedTrees?.ages).toEqual([plantedTreeMatureAgeSeconds])
	})
})
