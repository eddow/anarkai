import { traces } from 'ssh/dev/debug'
import type { FreightLineDefinition } from 'ssh/freight/freight-line'
import { normalizeFreightLineDefinition } from 'ssh/freight/freight-line'
import { gatherFreightLine } from '../freight-fixtures'
import type { SaveState } from 'ssh/game'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('terminal border convey', () => {
	it('stores wood at freight bay after terminal convey from vehicle', async () => {
		const engine = new TestEngine({ terrainSeed: 13000, characterCount: 1 })
		await engine.init()
		try {
			// Setup: freight bay at (0,0) with 1 storage buffering wood
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
							{
								coord: [0, 0],
								alveolus: 'freight_bay',
								goods: { wood: 0 },
							},
						],
					},
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)

			// Add vehicle with wood at adjacent tile
			const vehicle = engine.game.vehicles.createVehicle(
				'wheelbarrow-v',
				'wheelbarrow',
				{ q: 1, r: 0 },
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
			expect(bayTile).toBeDefined()
			const bay = bayTile?.content as StorageAlveolus | undefined
			expect(bay).toBeDefined()
			expect(vehicle.storage.stock.wood).toBe(1)
			expect(bay?.storage.stock.wood ?? 0).toBe(0) // Bay has no wood yet
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

			// After convey completes, verify wood is in bay storage
			expect(vehicle.storage.stock.wood ?? 0).toBe(0) // Vehicle wood moved
			expect(bay?.storage.stock.wood).toBe(1) // Bay received the wood
			expect(bay?.proposedJobs).toHaveLength(0) // No more convey jobs

			// Verify no loose goods were generated
			expect(bayTile?.looseGoods.length).toBe(0)

			// Verify no errors in traces
			const errorLogs = traces.convey.error?.()
			expect(errorLogs).toBeUndefined()
		} finally {
			await engine.destroy()
		}
	})
})
