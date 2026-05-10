import { traces } from 'ssh/dev/debug'
import type { SaveState } from 'ssh/game'
import type { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import { StorageAlveolus } from 'ssh/hive/storage'
import { describe, expect, it } from 'vitest'
import { gatherFreightLine } from '../freight-fixtures'
import { TestEngine } from '../test-engine'

describe('terminal border convey', () => {
	it('stores wood at nearby storage after terminal convey from vehicle dock', async () => {
		const engine = new TestEngine({ terrainSeed: 13000, characterCount: 1 })
		await engine.init()
		try {
			// Setup: freight bay dock at (0,0), adjacent storage buffering wood.
			const line = gatherFreightLine({
				id: 'terminal-border-convey',
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

			// Add vehicle with wood at the freight bay.
			const vehicle = engine.game.vehicles.createVehicle(
				'wheelbarrow-v',
				'wheelbarrow',
				{ q: 0, r: 0 },
				[line]
			)
			vehicle.storage.addGood('wood', 1)
			// Use the anchor stop (second stop) for vehicle service
			const anchorStop = line.stops.find((stop) => 'anchor' in stop)
			if (!anchorStop) throw new Error('No anchor stop found in freight line')
			vehicle.beginLineService(line, anchorStop)
			vehicle.dock()

			// Wait for initial setup to settle
			await engine.tick(5)

			// Verify bay exists and has no wood yet
			const bayTile = engine.game.hex.getTile({ q: 0, r: 0 })
			const storageTile = engine.game.hex.getTile({ q: 1, r: 0 })
			expect(bayTile).toBeDefined()
			expect(storageTile).toBeDefined()
			const bay = bayTile?.content as FreightBayAlveolus | undefined
			const storage = storageTile?.content as StorageAlveolus | undefined
			expect(bay).toBeDefined()
			expect(storage).toBeInstanceOf(StorageAlveolus)
			storage?.setBuffers({ wood: 10 })
			expect(vehicle.storage.stock.wood).toBe(1)
			expect(storage?.storage.stock.wood ?? 0).toBe(0)
			expect(bay?.proposedJobs).toHaveLength(1)

			// Get the convey job
			const conveyJob = bay?.proposedJobs.find((job) => job.job === 'convey')
			expect(conveyJob).toBeDefined()

			// Worker takes the job
			const worker = engine.game.population.createCharacter('BayWorker', { q: 0, r: 0 })
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
			expect(bayTile?.looseGoods.length).toBe(0)
			expect(storageTile?.looseGoods.length).toBe(0)

			// Verify no errors in traces
			const errorLogs = traces.convey.error?.()
			expect(errorLogs).toBeUndefined()
		} finally {
			await engine.destroy()
		}
	})
})
