import { inert } from 'mutts'
import type { SaveState } from 'ssh/game'
import { options } from 'ssh/globals'
import type { Character } from 'ssh/population/character'
import {
	activityUtilityConfig,
	applyActivityHysteresis,
	computeActivityScores,
} from 'ssh/population/findNextActivity'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine/engine'

/**
 * When `keepWorking` is true and a job exists, `bestWork` should not lose to `wander` purely because
 * wander’s projection ends with `rest` (see `workPreferenceWhenFit`). If all needs are already
 * **negative** (bounded scale: toward −1 = comfortable), taking a walk to “rest” has little
 * marginal benefit in the model — work should still win over strolling.
 */
describe('Planner: work preferred over wander when fit and a job exists', () => {
	async function harvestScenario() {
		const previousWatchdogInterval = options.stalledMovementScanIntervalMs
		options.stalledMovementScanIntervalMs = 0
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
					deposit: { type: 'tree', name: 'tree', amount: 10 },
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
		return { engine, worker, previousWatchdogInterval }
	}

	function assertBestWorkFirst(worker: Character) {
		expect(worker.keepWorking).toBe(true)
		expect(inert(() => worker.resolveBestJobMatch())).toBeTruthy()
		const ranked = inert(() =>
			applyActivityHysteresis(
				computeActivityScores(worker),
				undefined,
				activityUtilityConfig.hysteresis
			)
		)
		expect(ranked[0]?.kind).toBe('bestWork')
	}

	it('all needs negative (well rested): bestWork still beats wander when a job exists', async () => {
		const { engine, worker, previousWatchdogInterval } = await harvestScenario()
		try {
			worker.hunger = -0.35
			worker.fatigue = -0.28
			worker.tiredness = -0.4
			assertBestWorkFirst(worker)
		} finally {
			options.stalledMovementScanIntervalMs = previousWatchdogInterval
			await engine.destroy()
		}
	})

	it('bestWork ranks above wander (mild positive needs, keepWorking, resolveBestJobMatch truthy)', async () => {
		const { engine, worker, previousWatchdogInterval } = await harvestScenario()
		try {
			worker.hunger = 0.05
			worker.fatigue = 0.05
			worker.tiredness = 0.05
			assertBestWorkFirst(worker)
		} finally {
			options.stalledMovementScanIntervalMs = previousWatchdogInterval
			await engine.destroy()
		}
	})
})
