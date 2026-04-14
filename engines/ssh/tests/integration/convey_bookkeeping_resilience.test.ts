import { traces } from 'ssh/debug'
import type { SaveState } from 'ssh/game'
import { BuildAlveolus } from 'ssh/hive/build'
import { axial } from 'ssh/utils'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

async function flushDeferred(turns: number = 3) {
	for (let i = 0; i < turns; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0))
	}
}

describe('Convey bookkeeping resilience', () => {
	it('recovers when a provider reservation counter is stale before conveyStep fulfills it', {
		timeout: 20000,
	}, async () => {
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
			if (!movement)
				throw new Error('Expected plank movement to exist')

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
	})

	it('conveys planks from a sawmill into build storage without movement warnings', {
		timeout: 20000,
	}, async () => {
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
			worker.hunger = 0
			worker.tiredness = 0
			worker.fatigue = 0
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
					`tick=${i} sawmillPlanks=${sawmill.storage.stock.planks || 0} buildPlanks=${buildPlanks} movingPlanks=${movingPlanks} workerAction=${worker.actionDescription.join('/') || 'none'}`
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
	})

	// BUG regression (transient tile source invalidation vs microtask ordering) lived here as
	// `it.fails`, but Vitest 3.2 worker RPC can overflow while serializing that task's results.
	// Restore from git history when fixing the underlying behaviour.

	it('removes stale duplicate movement tracking before a worker advances the good', {
		timeout: 20000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		const originalAdvertisingTrace = traces.advertising

		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'PlankDuplicateTrackingHive',
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

			const staleCoord = { q: 5, r: 5 }
			sawmill.hive.movingGoods.set(staleCoord, [movement])
			const warnings: string[] = []
			const noop = () => {}
			traces.advertising = {
				log: noop,
				info: noop,
				debug: noop,
				error: noop,
				warn: (...args: unknown[]) => {
					warnings.push(args.map(String).join(' '))
				},
			} as typeof console

			const worker = engine.spawnCharacter('PlankWorker', { q: 0, r: 0 })
			worker.role = 'worker'
			void worker.scriptsContext
			const action = worker.findAction()
			if (action) worker.begin(action)

			expect(() => engine.tick(0.25)).not.toThrow()
			await flushDeferred()

			const trackedEntries = Array.from(sawmill.hive.movingGoods.entries())
				.filter(([, goods]: [any, any[]]) =>
					goods.some((candidate) => candidate._mgId === movement._mgId)
				)
				.map(([coord]: [any, any[]]) => axial.key(coord))

			expect(trackedEntries).not.toContain(axial.key(staleCoord))
			expect(trackedEntries.length).toBeLessThanOrEqual(1)
			expect(
				warnings.some((warning) =>
					warning.includes('[WATCHDOG] Collapsed duplicate movement tracking')
				)
			).toBe(true)
			expect(
				warnings.some(
					(warning) =>
						warning.includes('[WATCHDOG] Broken movement') ||
						warning.includes('tracked-at-wrong-position')
				)
			).toBe(false)
		} finally {
			traces.advertising = originalAdvertisingTrace
			await engine.destroy()
		}
	})

	it('keeps wrapper and canonical movement tracking aligned after place', {
		timeout: 20000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'PlankWrapperTrackingHive',
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

			const selection = sawmill.aGoodMovement?.find(
				(candidate: any) => candidate.movement.goodType === 'planks'
			)
			expect(selection).toBeDefined()
			if (!selection) throw new Error('Expected movement selection to exist')

			selection.movement.claimed = true
			sawmill.hive.fulfillMovementSource(selection.movement, 'test.wrapper.pickup')
			const hop = selection.movement.hop()
			expect(hop).toBeDefined()
			selection.movement.place()

			expect(() =>
				sawmill.hive.assertMovementMine(selection.movement, {
					label: 'test.wrapper.after-place',
					expectedFrom: hop,
					expectClaimed: true,
					requireTracked: true,
					requireSourceValid: false,
					requireTargetValid: true,
					allowClaimedSourceGap: true,
					allowClaimedTerminalPath: true,
				})
			).not.toThrow()
		} finally {
			await engine.destroy()
		}
	})

	it('does not report a stalled exchange while the movement is still active in-flight', {
		timeout: 20000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		const originalAdvertisingTrace = traces.advertising

		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'PlankInflightWatchdogHive',
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

			movement.claimed = true
			movement.claimedAtMs = Date.now() - 10_000
			sawmill.hive.removeMovementFromCoordTracking?.(movement._mgId)

			const warnings: string[] = []
			const noop = () => {}
			traces.advertising = {
				log: noop,
				info: noop,
				debug: noop,
				error: noop,
				warn: (...args: unknown[]) => {
					warnings.push(args.map(String).join(' '))
				},
			} as typeof console

			sawmill.hive.scanForStalledExchanges?.()

			expect(warnings.some((warning) => warning.includes('[WATCHDOG] STALLED EXCHANGE'))).toBe(
				false
			)
		} finally {
			traces.advertising = originalAdvertisingTrace
			await engine.destroy()
		}
	})
})
