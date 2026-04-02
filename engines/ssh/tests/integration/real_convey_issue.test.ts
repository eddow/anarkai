import type { SaveState } from 'ssh/game'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('Real Convey Issue Test', () => {
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

	it('should create movements when gatherer provides wood and sawmill demands wood', {
		timeout: 20000,
	}, async () => {
		const { engine, game, spawnWorker } = await setupEngine()
		try {
			// Setup: Gatherer with wood, Sawmill that needs wood (adjacent)
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'TestHive',
						alveoli: [
							{
								coord: [0, 0],
								alveolus: 'gather',
								goods: { wood: 5 }, // Gatherer starts with wood
							},
							{
								coord: [1, 0], // ADJACENT to gatherer
								alveolus: 'sawmill',
								goods: {},
							},
						],
					},
				],
			}

			engine.loadScenario(scenario)

			const gatherer = game.hex.getTile({ q: 0, r: 0 })?.content as any
			const sawmill = game.hex.getTile({ q: 1, r: 0 })?.content as any
			const hive = gatherer.hive

			// Spawn workers
			const gathererWorker = spawnWorker({ q: 0, r: 0 })
			gathererWorker.assignedAlveolus = gatherer
			gatherer.assignedWorker = gathererWorker

			const sawmillWorker = spawnWorker({ q: 1, r: 0 })
			sawmillWorker.assignedAlveolus = sawmill
			sawmill.assignedWorker = sawmillWorker

			// Check initial state
			console.log('Initial gatherer goods:', gatherer.storage.stock)
			console.log('Initial sawmill goods:', sawmill.storage.stock)
			console.log('Initial movements:', hive.movingGoods.size)
			console.log('Initial advertisements:', hive.advertisements)
			console.log('Gatherer goodsRelations:', gatherer.goodsRelations)
			console.log('Sawmill goodsRelations:', sawmill.goodsRelations)
			console.log('Gatherer working:', gatherer.working)
			console.log('Sawmill working:', sawmill.working)
			console.log('Gatherer gates:', gatherer.gates.length)
			console.log('Sawmill gates:', sawmill.gates.length)
			console.log('Path between them:', hive.getPath(gatherer, sawmill, 'wood'))

			// Let workers work and see if movements are created
			for (let i = 0; i < 20; i++) {
				engine.tick(0.5)
				await new Promise((resolve) => setTimeout(resolve, 0))

				console.log(`Tick ${i}: movements=${hive.movingGoods.size}`)

				// Check if any convey jobs are available
				const gathererJob = gatherer.getJob(gathererWorker)
				const sawmillJob = sawmill.getJob(sawmillWorker)

				console.log(`Gatherer job:`, gathererJob?.job)
				console.log(`Sawmill job:`, sawmillJob?.job)

				if (gathererJob?.job === 'convey' || sawmillJob?.job === 'convey') {
					console.log('SUCCESS: Convey job found!')
					break
				}
			}

			// Check final state
			console.log('Final gatherer goods:', gatherer.storage.stock)
			console.log('Final sawmill goods:', sawmill.storage.stock)
			console.log('Final movements:', hive.movingGoods.size)

			// The issue: movements should be created but they're not
			expect(hive.movingGoods.size).toBeGreaterThan(0)
		} finally {
			await engine.destroy()
		}
	})
})
