import type { SaveState } from 'ssh/game'
import { BuildAlveolus } from 'ssh/hive/build'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

async function flushDeferred(turns: number = 3) {
	for (let i = 0; i < turns; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0))
	}
}

describe('Convey bookkeeping resilience', () => {
	it(
		'recovers when a provider reservation counter is stale before conveyStep fulfills it',
		{ timeout: 20000 },
		async () => {
			const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
			await engine.init()

			try {
				const scenario: Partial<SaveState> = {
					hives: [
						{
							name: 'PlankResilienceHive',
							alveoli: [
								{ coord: [0, 0], alveolus: 'sawmill', goods: { planks: 1 } },
								{ coord: [1, 0], alveolus: 'storage', goods: {} },
							],
						},
					],
				}

				engine.loadScenario(scenario)
				await flushDeferred()

				const sawmill = engine.game.hex.getTile({ q: 0, r: 0 })?.content as any
				const storage = engine.game.hex.getTile({ q: 1, r: 0 })?.content as any
				expect(sawmill).toBeDefined()
				expect(storage).toBeDefined()
				if (!sawmill || !storage) throw new Error('Expected sawmill/storage to exist')

				storage.setBuffers?.({ planks: 10 })
				await flushDeferred()

				const movement = Array.from(sawmill.hive.movingGoods.values())
					.flat()
					.find((candidate: any) => candidate.goodType === 'planks')
				expect(movement).toBeDefined()
				if (!movement) throw new Error('Expected plank movement to exist')

				// Corrupt the provider-side reservation bookkeeping while leaving the token alive.
				;(sawmill.storage as { _reserved?: Record<string, number> })._reserved!.planks = 0

				const worker = engine.spawnCharacter('PlankWorker', { q: 0, r: 0 })
				worker.role = 'worker'
				void worker.scriptsContext
				const action = worker.findAction()
				if (action) worker.begin(action)

				expect(() => engine.tick(0.25)).not.toThrow()
				await flushDeferred()

				expect(worker.destroyed).toBe(false)
			} finally {
				await engine.destroy()
			}
		}
	)

	it(
		'conveys planks from a sawmill into build storage without movement warnings',
		{ timeout: 20000 },
		async () => {
			const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
			await engine.init()

			try {
				const scenario: Partial<SaveState> = {
					hives: [
						{
							name: 'PlankBuildHive',
							alveoli: [{ coord: [0, 0], alveolus: 'sawmill', goods: { planks: 1 } }],
						},
					],
				}

				engine.loadScenario(scenario)
				await flushDeferred()

				const buildTile = engine.game.hex.getTile({ q: 1, r: 0 })
				expect(buildTile).toBeDefined()
				if (!buildTile) throw new Error('Expected build tile to exist')
				buildTile.content = new BuildAlveolus(buildTile, 'storage')
				await flushDeferred()

				const sawmill = engine.game.hex.getTile({ q: 0, r: 0 })?.content as any
				const buildStorage = buildTile.content as any
				expect(sawmill).toBeDefined()
				expect(buildStorage).toBeDefined()
				if (!sawmill || !buildStorage) throw new Error('Expected sawmill/build storage to exist')

				const worker = engine.spawnCharacter('PlankWorker', { q: 0, r: 0 })
				worker.role = 'worker'
				void worker.scriptsContext
				const action = worker.findAction()
				if (action) worker.begin(action)

				let reachedGoal = false
				const timeline: string[] = []

				for (let i = 0; i < 60; i++) {
					engine.tick(0.25)
					if (i % 4 === 0) await flushDeferred(1)

					const buildPlanks = buildStorage.storage.stock.planks || 0
					const movingPlanks = Array.from(sawmill.hive.movingGoods.values())
						.flat()
						.filter((movement: any) => movement.goodType === 'planks').length
					timeline.push(
						`tick=${i} sawmillPlanks=${sawmill.storage.stock.planks || 0} buildPlanks=${buildPlanks} movingPlanks=${movingPlanks} workerAction=${worker.actionDescription.join('/') || 'none'}`,
					)
					if (buildPlanks >= 1) {
						reachedGoal = true
						break
					}
				}

				expect(reachedGoal, timeline.join('\n')).toBe(true)
			} finally {
				await engine.destroy()
			}
		},
	)

	it(
		'does not warn when a sawmill to build storage movement briefly loses its tile source allocation before the next microtask',
		{ timeout: 20000 },
		async () => {
			const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
			await engine.init()

			try {
				const scenario: Partial<SaveState> = {
					hives: [
						{
							name: 'PlankTransientSourceHive',
							alveoli: [{ coord: [0, 0], alveolus: 'sawmill', goods: { planks: 1 } }],
						},
					],
				}

				engine.loadScenario(scenario)
				await flushDeferred()

				const buildTile = engine.game.hex.getTile({ q: 1, r: 0 })
				expect(buildTile).toBeDefined()
				if (!buildTile) throw new Error('Expected build tile to exist')
				buildTile.content = new BuildAlveolus(buildTile, 'storage')
				await flushDeferred()

				const sawmill = engine.game.hex.getTile({ q: 0, r: 0 })?.content as any
				const buildStorage = buildTile.content as any
				expect(sawmill).toBeDefined()
				expect(buildStorage).toBeDefined()
				if (!sawmill || !buildStorage) throw new Error('Expected sawmill/build storage to exist')

				const movement = Array.from(sawmill.hive.movingGoods.values())
					.flat()
					.find(
						(candidate: any) =>
							candidate.goodType === 'planks' &&
							candidate.provider === sawmill &&
							candidate.demander === buildStorage,
					)
				expect(movement).toBeDefined()
				if (!movement) throw new Error('Expected plank movement to exist')

				const staleSource = movement.allocations.source
				staleSource.cancel()
				movement.allocations.source = staleSource

				// Trigger tile-movement validation while the source token is transiently invalid.
				void sawmill.aGoodMovement

				movement.allocations.source = sawmill.storage.reserve(
					{ planks: 1 },
					{
						type: 'convey.path',
						goodType: 'planks',
						movementId: movement._mgId,
						providerRef: movement.provider,
						demanderRef: movement.demander,
						providerName: movement.provider.name,
						demanderName: movement.demander.name,
						movement,
					},
				)

				await flushDeferred()

				const remainingMovement = Array.from(sawmill.hive.movingGoods.values())
					.flat()
					.find((candidate: any) => candidate._mgId === movement._mgId)
				expect(remainingMovement).toBeDefined()
				expect(sawmill.aGoodMovement?.some((candidate: any) => candidate._mgId === movement._mgId)).toBe(true)
			} finally {
				await engine.destroy()
			}
		},
	)
})
