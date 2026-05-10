import { traces } from 'ssh/dev/debug'
import type { SaveState } from 'ssh/game'
import type { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import { StorageAlveolus } from 'ssh/hive/storage'
import { describe, expect, it } from 'vitest'
import { gatherFreightLine } from '../freight-fixtures'
import { TestEngine } from '../test-engine'

describe('terminal border convey (fixed)', () => {
	it('stores wood at nearby storage after terminal convey from vehicle dock', async () => {
		const engine = new TestEngine({ terrainSeed: 13000, characterCount: 0 })
		await engine.init()
		try {
			// Setup: freight bay dock at (0,0), adjacent storage buffering wood.
			const line = gatherFreightLine({
				id: 'terminal-border-convey-fixed',
				name: 'Vehicle to Bay',
				hiveName: 'ChopSaw',
				coord: [0, 0],
				filters: ['wood'],
				radius: 1,
			})
			engine.loadScenario({
				hives: [
					{
						name: 'ChopSaw',
						alveoli: [
							{ coord: [0, 0], alveolus: 'freight_bay', goods: {} },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)

			// Add vehicle with wood at adjacent tile
			const vehicle = engine.game.vehicles.createVehicle(
				'wheelbarrow-v',
				'wheelbarrow',
				{ q: 0, r: 0 },
				[line]
			)
			vehicle.storage.addGood('wood', 1)
			vehicle.beginLineService(line, line.stops[1]!)
			vehicle.dock()

			// Add worker at bay tile
			const worker = engine.game.population.createCharacter('BayWorker', { q: 0, r: 0 })
			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content as FreightBayAlveolus | undefined
			const storage = engine.game.hex.getTile({ q: 1, r: 0 })?.content as
				| StorageAlveolus
				| undefined
			expect(storage).toBeInstanceOf(StorageAlveolus)
			storage?.setBuffers({ wood: 10 })

			// Wait for initial setup to settle
			await engine.tick(5)

			// Verify initial state
			expect(vehicle.storage.stock.wood).toBe(1)
			expect(storage?.storage.stock.wood ?? 0).toBe(0)
			expect(bay?.proposedJobs).toHaveLength(1)

			// Get the convey job
			const conveyJob = bay?.proposedJobs.find((job) => job.job === 'convey')
			expect(conveyJob).toBeDefined()

			// Worker takes the job
			const action = worker.findAction()
			expect(action).toBeTruthy()
			if (action) worker.begin(action)

			// Wait for worker to pick up and convey
			await engine.tick(50)

			// After convey completes, verify wood is in real hive storage.
			expect(vehicle.storage.stock.wood ?? 0).toBe(0) // Vehicle wood moved
			expect(storage?.storage.stock.wood).toBe(1)
			expect(bay?.proposedJobs).toHaveLength(0) // No more convey jobs

			// Verify no loose goods were generated
			const bayTile = engine.game.hex.getTile({ q: 0, r: 0 })
			expect(bayTile?.looseGoods.length).toBe(0)

			// Verify no errors in traces
			const errorLogs = traces.convey.error?.()
			expect(errorLogs).toBeUndefined()
		} finally {
			await engine.destroy()
		}
	})

	it('handles multiple terminal movements at border without invariant failures', async () => {
		const engine = new TestEngine({ terrainSeed: 13001, characterCount: 0 })
		await engine.init()
		try {
			// Setup: freight bay dock with adjacent storage.
			const line = gatherFreightLine({
				id: 'multi-terminal-fixed',
				name: 'Multi Terminal',
				hiveName: 'ChopSaw',
				coord: [0, 0],
				filters: ['wood'],
				radius: 1,
			})
			engine.loadScenario({
				hives: [
					{
						name: 'ChopSaw',
						alveoli: [
							{ coord: [0, 0], alveolus: 'freight_bay', goods: {} },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)

			// Add two vehicles with wood
			const vehicle1 = engine.game.vehicles.createVehicle('v1', 'wheelbarrow', { q: 1, r: 0 }, [
				line,
			])
			vehicle1.storage.addGood('wood', 1)
			vehicle1.beginLineService(line, line.stops[1]!)
			vehicle1.dock()

			const vehicle2 = engine.game.vehicles.createVehicle('v2', 'wheelbarrow', { q: 2, r: 0 }, [
				line,
			])
			vehicle2.storage.addGood('wood', 1)
			vehicle2.beginLineService(line, line.stops[1]!)
			vehicle2.dock()

			const storage = engine.game.hex.getTile({ q: 1, r: 0 })?.content as
				| StorageAlveolus
				| undefined
			expect(storage).toBeInstanceOf(StorageAlveolus)
			storage?.setBuffers({ wood: 10 })

			// Wait for setup
			await engine.tick(5)

			// Add two workers after dock advertisements settle.
			const worker1 = engine.game.population.createCharacter('Worker1', { q: 0, r: 0 })
			const worker2 = engine.game.population.createCharacter('Worker2', { q: 1, r: 0 })

			// Both workers take convey jobs
			const action1 = worker1.findAction()
			const action2 = worker2.findAction()
			expect(action1).toBeTruthy()
			expect(action2).toBeTruthy()
			if (action1) worker1.begin(action1)
			if (action2) worker2.begin(action2)

			// Wait for both conveys to complete
			await engine.tick(50)

			// Verify both deliveries completed without errors
			expect(vehicle1.storage.stock.wood ?? 0).toBe(0)
			expect(vehicle2.storage.stock.wood ?? 0).toBe(0)
			expect(storage?.storage.stock.wood).toBe(2)

			// Verify no invariant errors
			const errorLogs = traces.convey.error?.()
			expect(errorLogs).toBeUndefined()
		} finally {
			await engine.destroy()
		}
	})
})
