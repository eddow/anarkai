import type { SaveState } from 'ssh/game'
import { axial } from 'ssh/utils/axial'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('Convey Stall Reproduction', () => {
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

	it('assigned workers should react when a movement is created', {
		timeout: 15000,
	}, async () => {
		const { engine, game, spawnWorker } = await setupEngine()

		// Setup: Two alveoli. 0,0 is storage, 1,0 is sawmill.
		// Sawmill starts empty.
		const scenario: Partial<SaveState> = {
			hives: [
				{
					name: 'TestHive',
					alveoli: [
						{
							coord: [0, 0],
							alveolus: 'storage',
							goods: {},
						},
						{
							coord: [1, 0],
							alveolus: 'sawmill',
							goods: {},
						},
					],
				},
			],
		}

		engine.loadScenario(scenario)

		const sawmillTile = game.hex.getTile({ q: 1, r: 0 })
		const sawmill = sawmillTile?.content as any
		const storageTile = game.hex.getTile({ q: 0, r: 0 })
		const storage = storageTile?.content as any

		// Spawn both workers FIRST
		const char = spawnWorker({ q: 1, r: 0 })
		char.name = 'SawmillWorker'
		char.assignedAlveolus = sawmill
		sawmill.assignedWorker = char
		const sawmillAction = char.findAction()
		if (sawmillAction) char.begin(sawmillAction)

		const storageWorker = spawnWorker({ q: 0, r: 0 })
		storageWorker.name = 'StorageWorker'
		storageWorker.assignedAlveolus = storage
		storage.assignedWorker = storageWorker
		const storageAction = storageWorker.findAction()
		if (storageAction) storageWorker.begin(storageAction)

		storage.storage.addGood('wood', 1)

		const movements = storage.aGoodMovement
		if (movements && movements.length > 0) {
			const mg = movements[0]
			const pathArr = Array.from(mg.path)
			expect(pathArr.map((p: any) => axial.key(p))).toEqual(['0.5,0', '1,0'])
		}

		let storageWorkerReacted = false
		for (let i = 0; i < 40; i++) {
			engine.tick(0.1)
			if (i % 5 === 0) {
				await new Promise((resolve) => setTimeout(resolve, 0))
			}
			const executorName = storageWorker.stepExecutor?.constructor.name
			if (executorName === 'MoveToStep' || executorName === 'PonderingStep') {
				storageWorkerReacted = true
				break
			}
		}
		expect(storageWorkerReacted).toBe(true)
		expect(storage.aGoodMovement?.length ?? 0).toBeGreaterThan(0)
	})
})
