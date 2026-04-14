import type { SaveState } from 'ssh/game'
import { axial } from 'ssh/utils/axial'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('Convey Stall Reproduction', () => {
	async function flushDeferred(turns: number = 24) {
		for (let i = 0; i < turns; i++) {
			await new Promise((resolve) => setTimeout(resolve, 0))
		}
	}

	async function setupEngine(options: any = { terrainSeed: 1234, characterCount: 0 }) {
		const engine = new TestEngine(options)
		await engine.init()

		function spawnWorker(coord: { q: number; r: number }) {
			const char = engine.spawnCharacter('Worker', coord)
			char.role = 'worker'
			char.hunger = 0
			char.tiredness = 0
			char.fatigue = 0
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
				looseGoods: [],
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
			const selection = movements?.[0]
			expect(selection).toBeDefined()
			if (!selection) {
				throw new Error('Expected provider movement to exist')
			}
			const mg = selection.movement
			expect(mg.path).toBeDefined()
			const pathArr = Array.from(mg.path ?? [])
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
								goods: { wood: 1 },
							},
							{
								coord: [1, 0],
								alveolus: 'woodpile',
								goods: {},
							},
						],
					},
				],
				looseGoods: [],
			}

			engine.loadScenario(scenario)

			const gather = game.hex.getTile({ q: 0, r: 0 })?.content as any
			expect(gather).toBeDefined()
			if (!gather) throw new Error('Expected gather alveolus to exist')
			const woodpileAlveolus = game.hex.getTile({ q: 1, r: 0 })?.content as any
			// Ensure both logistics endpoints participate in advertisements even before workers attach.
			gather.working = true
			woodpileAlveolus.working = true
			woodpileAlveolus.setBuffers?.({ wood: 1 })

			expect(gather.storage.stock.wood ?? 0).toBeGreaterThan(0)
			await flushDeferred()
			expect(
				gather.hive?.movingGoods.size ?? 0,
				'expected hive logistics to create a movement once gather has outbound stock'
			).toBeGreaterThan(0)

			const worker = spawnWorker({ q: 0, r: 0 })
			worker.name = 'AssignedGatherWorker'
			worker.assignedAlveolus = gather
			gather.assignedWorker = worker

			const jobAction = worker.findBestJob()
			expect(jobAction).toBeDefined()
			if (!jobAction) throw new Error('Expected assigned worker to find a job action')
			worker.begin(jobAction)

			let sawGoWork = false
			for (let i = 0; i < 200; i++) {
				engine.tick(0.1)
				if (i % 10 === 0) await flushDeferred()
				if (worker.actionDescription.includes('work.goWork')) {
					sawGoWork = true
					break
				}
			}

			expect(sawGoWork, `action trail=${JSON.stringify(worker.actionDescription)}`).toBe(true)
		} finally {
			await engine.destroy()
		}
	})
})
