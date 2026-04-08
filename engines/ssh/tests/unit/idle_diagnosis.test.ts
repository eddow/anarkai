import { inert } from 'mutts'
import type { SaveState } from 'ssh/game'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine/engine'

describe('Idle diagnosis: lastPlannerSnapshot', () => {
	async function harvestScenario() {
		const engine = new TestEngine({
			terrainSeed: 42_001,
			characterCount: 0,
		})
		await engine.init()
		const scenario: Partial<SaveState> = {
			generationOptions: {
				terrainSeed: 42_001,
				characterCount: 0,
			},
			tiles: [
				{
					coord: [1, 0],
					deposit: { type: 'tree', amount: 10 },
					terrain: 'forest',
				},
			],
			hives: [
				{
					name: 'WorkHive',
					alveoli: [{ coord: [1, 2], alveolus: 'tree_chopper', goods: {} }],
				},
			],
			zones: {
				harvest: [[1, 0]],
			},
		}
		engine.loadScenario(scenario)
		const worker = engine.spawnCharacter('Worker', { q: 2, r: 2 })
		;(worker as { role?: string }).role = 'worker'
		void worker.scriptsContext
		return { engine, worker }
	}

	it('records ranked bestWork when a job exists and tryScript succeeds', async () => {
		const { engine, worker } = await harvestScenario()
		try {
			worker.hunger = -0.35
			worker.fatigue = -0.28
			worker.tiredness = -0.4
			expect(worker.keepWorking).toBe(true)
			inert(() => {
				void worker.findAction()
			})
			expect(worker.lastPlannerSnapshot).toBeDefined()
			expect(worker.lastPlannerSnapshot!.outcome.source).toBe('ranked')
			expect(worker.lastPlannerSnapshot!.outcome.kind).toBe('bestWork')
			const kinds = worker.lastPlannerSnapshot!.ranked.map((r) => r.kind)
			expect(kinds).toContain('bestWork')
		} finally {
			await engine.destroy()
		}
	})
})
