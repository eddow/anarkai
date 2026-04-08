import type { SaveState } from 'ssh/game'
import { axial } from 'ssh/utils/axial'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('Convey Stall Reproduction', () => {
	async function flushDeferred(turns: number = 3) {
		for (let i = 0; i < turns; i++) {
			await new Promise((resolve) => setTimeout(resolve, 0))
		}
	}

	async function setupEngine(
		options: any = { terrainSeed: 1234, characterCount: 0 }
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
		timeout: 20000,
	}, async () => {
		const { engine, game, spawnWorker } = await setupEngine()
		try {
			// Setup: A real provider/demander pair so a movement can be created.
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'TestHive',
						alveoli: [
							{
								coord: [0, 0],
								alveolus: 'tree_chopper',
								goods: { wood: 1 },
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
			const providerTile = game.hex.getTile({ q: 0, r: 0 })
			const provider = providerTile?.content as any

			// Spawn both workers FIRST
			const char = spawnWorker({ q: 1, r: 0 })
			char.name = 'SawmillWorker'
			sawmill.assignedWorker = char
			const sawmillAction = char.findAction()
			if (sawmillAction) char.begin(sawmillAction)

			const providerWorker = spawnWorker({ q: 0, r: 0 })
			providerWorker.name = 'ProviderWorker'
			const providerAction = providerWorker.findAction()
			if (providerAction) providerWorker.begin(providerAction)

			await flushDeferred()

			const movements = provider.aGoodMovement
			expect(movements?.length ?? 0).toBeGreaterThan(0)
			const mg = movements?.[0]
			expect(mg).toBeDefined()
			if (!mg) {
				throw new Error('Expected provider movement to exist')
			}
			const pathArr = Array.from(mg.path)
			expect(pathArr.map((p: any) => axial.key(p))).toEqual(['0.5,0', '1,0'])

			const nextAction = providerWorker.findAction()
			expect(nextAction).toBeDefined()
		} finally {
			await engine.destroy()
		}
	})

	it('assigned wandering workers should be woken when their alveolus gains a convey job', {
		timeout: 20000,
	}, async () => {
		const { engine, game, spawnWorker } = await setupEngine()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'WakeAssignedHive',
						alveoli: [
							{
								coord: [0, 0],
								alveolus: 'gather',
								goods: {},
							},
							{
								coord: [1, 0],
								alveolus: 'woodpile',
								goods: {},
							},
						],
					},
				],
			}

			engine.loadScenario(scenario)

			const gather = game.hex.getTile({ q: 0, r: 0 })?.content as any
			expect(gather).toBeDefined()
			if (!gather) throw new Error('Expected gather alveolus to exist')

			const worker = spawnWorker({ q: 0, r: 0 })
			worker.name = 'AssignedGatherWorker'
			worker.assignedAlveolus = gather
			gather.assignedWorker = worker

			const initialAction = worker.findAction()
			expect(initialAction).toBeDefined()
			if (!initialAction) throw new Error('Expected assigned worker to find an initial action')
			worker.begin(initialAction)

			expect(worker.actionDescription).toContain('selfCare.wander')

			gather.storage.addGood('wood', 1)
			await flushDeferred()

			expect(worker.actionDescription).toContain('work.goWork')
			expect(gather.getJob(worker)?.job).toBe('convey')
		} finally {
			await engine.destroy()
		}
	})
})
