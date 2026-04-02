import { effect } from 'mutts'
import type { HarvestAlveolus } from 'ssh/hive/harvest'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine/engine'

describe('Reactive boundaries', () => {
	async function setupHarvestScenario(withWorker: boolean = false) {
		const engine = new TestEngine({
			boardSize: 6,
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		engine.loadScenario({
			generationOptions: {
				boardSize: 6,
				terrainSeed: 1234,
				characterCount: 0,
			},
			tiles: [
				{
					coord: [1, 0],
					deposit: { type: 'tree', name: 'tree', amount: 10 },
					terrain: 'forest',
				},
			],
			hives: [
				{
					name: 'WorkHive',
					alveoli: [{ coord: [1, 2], alveolus: 'tree_chopper', goods: {} }],
				},
			],
			zones: {
				harvest: [[1, 0]],
			},
		} as any)
		const worker = withWorker ? engine.spawnCharacter('Worker', { q: 2, r: 2 }) : undefined
		if (worker) {
			worker.role = 'worker'
			void worker.scriptsContext
		}
		const harvestTile = engine.game.hex.getTile({ q: 1, r: 2 })
		const harvest = harvestTile?.content as HarvestAlveolus | undefined
		if (!harvest) throw new Error('Expected harvest alveolus')
		return { engine, worker, harvest }
	}

	it('harvest demand getter invalidates when hive advertisements change', {
		timeout: 15000,
	}, async () => {
		const { engine, harvest } = await setupHarvestScenario()
		try {
			const woodDemand = { wood: { advertisement: 'demand', priority: '2-use' } } as const
			expect(harvest.alveoliNeedingGood).toBe(0)
			harvest.hive.advertise(harvest, woodDemand)
			expect(harvest.alveoliNeedingGood).toBe(1)
			harvest.hive.advertise(harvest, {})
			expect(harvest.alveoliNeedingGood).toBe(0)
		} finally {
			await engine.destroy()
		}
	})

	it('findBestJob remains a momentaneous query across hive demand changes', {
		timeout: 15000,
	}, async () => {
		const { engine, worker, harvest } = await setupHarvestScenario(true)
		let runs = 0
		const stop = effect`test:findBestJob-boundary`(() => {
			runs += 1
			worker!.findBestJob()
		})
		try {
			expect(worker!.findBestJob()).toBeTruthy()
			expect(runs).toBe(1)
			harvest.hive.advertise(harvest, {
				wood: { advertisement: 'demand', priority: '2-use' },
			})
			expect(runs).toBe(1)
		} finally {
			stop()
			await engine.destroy()
		}
	})
})
