import type { SaveState } from 'ssh/game'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('Multi-Hop Convey Tests', () => {
	async function setupEngine(
		options: any = { boardSize: 12, terrainSeed: 1234, characterCount: 0 }
	) {
		const engine = new TestEngine(options)
		await engine.init()

		function spawnWorker(coord: { q: number; r: number }) {
			const char = engine.spawnCharacter('Worker', coord)
			char.role = 'worker'
			void char.scriptsContext
			return char
		}

		return { engine, game: engine.game, spawnWorker }
	}

	it('should create multi-hop movements through storage alveoli', {
		timeout: 20000,
	}, async () => {
		const { engine, game, spawnWorker } = await setupEngine()
		try {
			// Setup: Gatherer -> Storage -> Sawmill (multi-hop path)
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'TestHive',
						alveoli: [
							{
								coord: [0, 0],
								alveolus: 'gather',
								goods: { wood: 10 }, // Gatherer has excess wood
							},
							{
								coord: [1, 0], // Intermediate storage
								alveolus: 'storage',
								goods: {},
							},
							{
								coord: [2, 0], // Sawmill that needs wood
								alveolus: 'sawmill',
								goods: {},
							},
						],
					},
				],
			}

			engine.loadScenario(scenario)

			const gatherer = game.hex.getTile({ q: 0, r: 0 })?.content as any
			const storage = game.hex.getTile({ q: 1, r: 0 })?.content as any
			const sawmill = game.hex.getTile({ q: 2, r: 0 })?.content as any
			const hive = gatherer.hive

			// Spawn workers
			const gathererWorker = spawnWorker({ q: 0, r: 0 })
			gathererWorker.assignedAlveolus = gatherer
			gatherer.assignedWorker = gathererWorker

			const storageWorker = spawnWorker({ q: 1, r: 0 })
			storageWorker.assignedAlveolus = storage
			storage.assignedWorker = storageWorker

			const sawmillWorker = spawnWorker({ q: 2, r: 0 })
			sawmillWorker.assignedAlveolus = sawmill
			sawmill.assignedWorker = sawmillWorker

			// Check initial connectivity
			console.log('Initial state:')
			console.log('- Gatherer gates:', gatherer.gates.length)
			console.log('- Storage gates:', storage.gates.length)
			console.log('- Sawmill gates:', sawmill.gates.length)
			console.log('- Path gatherer->storage:', hive.getPath(gatherer, storage, 'wood'))
			console.log('- Path storage->sawmill:', hive.getPath(storage, sawmill, 'wood'))
			console.log('- Path gatherer->sawmill:', hive.getPath(gatherer, sawmill, 'wood'))

			// Check initial advertisements
			console.log('Initial advertisements:', hive.advertisements)
			console.log('Gatherer goodsRelations:', gatherer.goodsRelations)
			console.log('Storage goodsRelations:', storage.goodsRelations)
			console.log('Sawmill goodsRelations:', sawmill.goodsRelations)

			// Let the system work and see if multi-hop movements are created
			for (let i = 0; i < 30; i++) {
				engine.tick(0.5)
				await new Promise((resolve) => setTimeout(resolve, 0))

				console.log(`Tick ${i}:`)
				console.log(`- Movements: ${hive.movingGoods.size}`)

				// Check what jobs are available at each alveolus
				const gathererJob = gatherer.getJob(gathererWorker)
				const storageJob = storage.getJob(storageWorker)
				const sawmillJob = sawmill.getJob(sawmillWorker)

				console.log(
					`- Jobs: gatherer=${gathererJob?.job}, storage=${storageJob?.job}, sawmill=${sawmillJob?.job}`
				)
				console.log(
					`- Steps: gatherer=${gathererWorker.stepExecutor?.constructor.name}, storage=${storageWorker.stepExecutor?.constructor.name}, sawmill=${sawmillWorker.stepExecutor?.constructor.name}`
				)

				// Check goods distribution
				console.log(
					`- Goods: gatherer=${JSON.stringify(gatherer.storage.stock)}, storage=${JSON.stringify(storage.storage.stock)}, sawmill=${JSON.stringify(sawmill.storage.stock)}`
				)

				// Look for successful multi-hop convey
				if (hive.movingGoods.size > 0) {
					for (const [_, movements] of hive.movingGoods) {
						for (const movement of movements) {
							console.log(
								`- Movement: ${movement.goodType} from ${movement.provider.name} to ${movement.demander.name}, path length: ${movement.path.length}`
							)
							console.log(`  - Has allocations: ${!!movement.allocations}`)
						}
					}
				}

				// Start real worker actions through the scripted flow
				if (!gathererWorker.stepExecutor && gathererWorker.runningScripts.length === 0) {
					const action = gathererWorker.findAction()
					if (action) {
						console.log(`- Starting gatherer action: ${action.name}`)
						gathererWorker.begin(action)
					}
				}
				if (!storageWorker.stepExecutor && storageWorker.runningScripts.length === 0) {
					const action = storageWorker.findAction()
					if (action) {
						console.log(`- Starting storage action: ${action.name}`)
						storageWorker.begin(action)
					}
				}
				if (!sawmillWorker.stepExecutor && sawmillWorker.runningScripts.length === 0) {
					const action = sawmillWorker.findAction()
					if (action) {
						console.log(`- Starting sawmill action: ${action.name}`)
						sawmillWorker.begin(action)
					}
				}

				if (gathererWorker.runningScripts.length > 0) {
					console.log(`- Gatherer scripts: ${gathererWorker.actionDescription.join(' > ')}`)
				}

				// Success condition: wood moves from gatherer through storage to sawmill
				if ((sawmill.storage.stock.wood ?? 0) > 0 && gatherer.storage.stock.wood < 10) {
					console.log('SUCCESS: Multi-hop convey working!')
					break
				}
			}

			// Final verification
			console.log('Final state:')
			console.log('- Gatherer goods:', gatherer.storage.stock)
			console.log('- Storage goods:', storage.storage.stock)
			console.log('- Sawmill goods:', sawmill.storage.stock)
			console.log('- Total movements created:', hive.movingGoods.size)

			// The test should show that wood moves from gatherer to sawmill
			expect(sawmill.storage.stock.wood ?? 0).toBeGreaterThan(0)
			expect(gatherer.storage.stock.wood).toBeLessThan(10)
		} finally {
			await engine.destroy()
		}
	})
})
