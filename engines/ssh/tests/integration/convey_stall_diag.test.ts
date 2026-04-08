import { getActivationLog, reactiveOptions, reset } from 'mutts'
import type { SaveState } from 'ssh/game'
import { afterEach, describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

afterEach(() => {
	reset()
})

describe('Convey Stall Diagnostic', () => {
	it('captures recent activations for storage to sawmill with assigned workers', {
		timeout: 15000,
	}, async () => {
		const originalMaxChain = reactiveOptions.maxEffectChain
		let engine: TestEngine | undefined
		reactiveOptions.maxEffectChain = 40
		try {
			engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
			await engine.init()
			const currentEngine = engine
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'TestHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: {} },
							{ coord: [1, 0], alveolus: 'sawmill', goods: {} },
						],
					},
				],
			}
			currentEngine.loadScenario(scenario)
			const { game } = currentEngine
			const sawmill = game.hex.getTile({ q: 1, r: 0 })?.content as any
			const storage = game.hex.getTile({ q: 0, r: 0 })?.content as any
			const spawnWorker = (coord: { q: number; r: number }) => {
				const char = currentEngine.spawnCharacter('Worker', coord)
				char.role = 'worker'
				void char.scriptsContext
				return char
			}
			const char = spawnWorker({ q: 1, r: 0 })
			char.name = 'SawmillWorker'
			sawmill.assignedWorker = char
			const sawmillAction = char.findAction()
			if (sawmillAction) char.begin(sawmillAction)
			const storageWorker = spawnWorker({ q: 0, r: 0 })
			storageWorker.name = 'StorageWorker'
			storage.assignedWorker = storageWorker
			const storageAction = storageWorker.findAction()
			if (storageAction) storageWorker.begin(storageAction)
			try {
				storage.storage.addGood('wood', 1)
				expect(true).toBe(true)
			} catch (error) {
				const recentActivations = getActivationLog()
					.filter(Boolean)
					.slice(-60)
					.map((entry) => ({
						effect: entry.effect?.name || 'anon',
						object: entry.obj?.constructor?.name || typeof entry.obj,
						property: String(entry.prop),
					}))
				console.error('DIAG recentActivations:', JSON.stringify(recentActivations, null, 2))
				throw error
			}
		} finally {
			await engine?.destroy()
			reactiveOptions.maxEffectChain = originalMaxChain
		}
	})
})
