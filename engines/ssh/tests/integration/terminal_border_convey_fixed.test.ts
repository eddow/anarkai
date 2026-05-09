import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'
import { gatherFreightLine } from '../freight-fixtures'

describe('terminal border convey (fixed)', () => {
	it('stores wood at freight bay after terminal convey from vehicle', async () => {
		const engine = new TestEngine({ terrainSeed: 13000, characterCount: 2 })
		await engine.init()
		try {
			// Setup: freight bay at (0,0) with 1 storage buffering wood
			const line = gatherFreightLine({
				id: 'terminal-border-convey-fixed',
				name: 'Vehicle to Bay',
				stops: [
					{ id: 'bay', zone: { kind: 'radius', center: [0, 0], radius: 1 } },
				],
			})
			engine.loadScenario({
				hives: [
					{
						name: 'ChopSaw',
						alveoli: [
							{
								coord: [0, 0],
								alveolus: 'freight_bay',
								goods: { wood: 1 },
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
			vehicle.beginLineService(line, line.stops[0]!)
			vehicle.dock()

			// Add worker at bay tile
			const worker = engine.game.population.createCharacter('BayWorker', { q: 0, r: 0 })
			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content

			// Wait for initial setup to settle
			await engine.tick(5)

			// Verify initial state
			expect(vehicle.storage.stock.wood).toBe(1)
			expect(bay?.storage.stock.wood).toBe(0) // Bay has no wood yet
			expect(bay?.proposedJobs).toHaveLength(1)

			// Get the convey job
			const conveyJob = bay?.proposedJobs.find((job) => job.job === 'convey')
			expect(conveyJob).toBeDefined()
			expect(conveyJob?.source.kind).toBe('vehicle')

			// Worker takes the job
			const action = worker.findAction()
			expect(action).toBeTruthy()
			if (action) worker.begin(action)

			// Wait for worker to pick up and convey
			await engine.tick(50)

			// After convey completes, verify wood is in bay storage
			expect(vehicle.storage.stock.wood).toBe(0) // Vehicle wood moved
			expect(bay?.storage.stock.wood).toBe(1) // Bay received the wood
			expect(bay?.proposedJobs).toHaveLength(0) // No more convey jobs

			// Verify no loose goods were generated
			const bayTile = engine.game.hex.getTile({ q: 0, r: 0 })
			expect(bayTile?.looseGoods.getGoodsAt({ q: 0, r: 0 }).length).toBe(0)

			// Verify no errors in traces
			const errorLogs = traces.convey.error?.()
			expect(errorLogs).toBeUndefined()
		} finally {
			await engine.destroy()
		}
	})

	it('handles multiple terminal movements at border without invariant failures', async () => {
		const engine = new TestEngine({ terrainSeed: 13001, characterCount: 2 })
		await engine.init()
		try {
			// Setup: freight bay with storage
			const line = gatherFreightLine({
				id: 'multi-terminal-fixed',
				name: 'Multi Terminal',
				stops: [
					{ id: 'bay', zone: { kind: 'radius', center: [0, 0], radius: 1 } },
				],
			})
			engine.loadScenario({
				hives: [
					{
						name: 'ChopSaw',
						alveoli: [
							{
								coord: [0, 0],
								alveolus: 'freight_bay',
								goods: { wood: 1 },
							},
						],
					},
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)

			// Add two vehicles with wood
			const vehicle1 = engine.game.vehicles.createVehicle(
				'v1',
				'wheelbarrow',
				{ q: 1, r: 0 },
				[line]
			)
			vehicle1.storage.addGood('wood', 1)
			vehicle1.beginLineService(line, line.stops[0]!)
			vehicle1.dock()

			const vehicle2 = engine.game.vehicles.createVehicle(
				'v2',
				'wheelbarrow',
				{ q: 2, r: 0 },
				[line]
			)
			vehicle2.storage.addGood('wood', 1)
			vehicle2.beginLineService(line, line.stops[0]!)
			vehicle2.dock()

			// Add two workers
			const worker1 = engine.game.population.createCharacter('Worker1', { q: 0, r: 0 })
			const worker2 = engine.game.population.createCharacter('Worker2', { q: 0, r: 0 })

			// Wait for setup
			await engine.tick(5)

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
			expect(vehicle1.storage.stock.wood).toBe(0)
			expect(vehicle2.storage.stock.wood).toBe(0)
			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content
			expect(bay?.storage.stock.wood).toBe(2) // Bay received both wood deliveries

			// Verify no invariant errors
			const errorLogs = traces.convey.error?.()
			expect(errorLogs).toBeUndefined()
		} finally {
			await engine.destroy()
		}
})
