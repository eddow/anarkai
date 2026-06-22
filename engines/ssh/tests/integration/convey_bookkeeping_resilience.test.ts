// @ts-nocheck
import { traces } from 'ssh/dev/debug'
import type { SaveState } from 'ssh/game'
import { Hive } from 'ssh/hive'
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
	it('throws when a movement target allocation is invalid before hop', {
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
			if (!movement) throw new Error('Expected plank movement to exist')

		;(movement as any).claimed = true
		;(movement as any).allocations.target.cancel('test.invalid-target')
		expect(() => (movement as any).hop()).toThrow(/invalid-target-allocation/)
			await flushDeferred()
		} finally {
			await engine.destroy()
		}
	})

	it('creates 0-store fallback movement from full sawmill output to plain storage', {
		timeout: 20000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'PlankGeneralStorageHive',
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

			expect(storage.workingGoodsRelations.planks).toBeUndefined()
			expect(storage.canTake('planks', '0-store')).toBe(true)

			const movement = Array.from(sawmill.hive.movingGoods.values())
				.flat()
				.find(
					(candidate: any) =>
						candidate.goodType === 'planks' &&
						candidate.provider === sawmill &&
						candidate.demander === storage
				)

			expect(movement).toBeDefined()
		} finally {
			await engine.destroy()
		}
	})

	it('transforms wood into planks and drains them to plain general storage', {
		timeout: 20000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'SawmillPlainStorageFlowHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'sawmill', goods: { wood: 1 } },
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

			const worker = engine.spawnCharacter('SawmillWorker', { q: 0, r: 0 })
			worker.role = 'worker'
			worker.hunger = 0
			worker.fatigue = 0
			worker.tiredness = 0
			void worker.scriptsContext
			const firstAction = worker.findAction()
			if (firstAction) worker.begin(firstAction)

			const timeline: string[] = []
			let reachedGoal = false
			for (let i = 0; i < 80; i++) {
				engine.tick(0.25)
				if (i % 4 === 0) await flushDeferred(1)
				if (!worker.runningScript) {
					const action = worker.findAction()
					if (action) worker.begin(action)
				}

				const movingPlanks = Array.from(sawmill.hive.movingGoods.values())
					.flat()
					.filter((movement: any) => movement.goodType === 'planks').length
				const sawmillSlots = sawmill.storage.renderedGoods()?.slots ?? []
				const plankSlot = sawmillSlots.find((slot: any) => slot.goodType === 'planks')
				timeline.push(
					`tick=${i} sawmillWood=${sawmill.storage.stock.wood || 0} sawmillPlanks=${sawmill.storage.stock.planks || 0} sawmillPlanksPresent=${plankSlot?.present ?? 0} sawmillPlanksReserved=${plankSlot?.reserved ?? 0} storagePlanks=${storage.storage.stock.planks || 0} movingPlanks=${movingPlanks} action=${worker.actionDescription.join('/') || 'none'}`
				)
				if ((storage.storage.stock.planks || 0) >= 1) {
					reachedGoal = true
					break
				}
			}

			expect(reachedGoal, timeline.join('\n')).toBe(true)
			expect(storage.storage.stock.planks || 0, timeline.join('\n')).toBeGreaterThan(0)
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
			const buildStorageAlv = new BuildAlveolus(buildTile, 'storage')
			engine.game.hex.setTileContent(buildTile, buildStorageAlv as any)
			if (!buildStorageAlv.hive) Hive.for(buildTile).attach(buildStorageAlv)
			await flushDeferred()

			const sawmill = engine.game.hex.getTile({ q: 0, r: 0 })?.content as any
			const buildStorage = buildStorageAlv as any
			expect(sawmill).toBeDefined()
			expect(buildStorage).toBeDefined()
			if (!sawmill || !buildStorage) throw new Error('Expected sawmill/build storage to exist')
			const movementAlreadyCreated = Array.from(sawmill.hive.movingGoods.values())
				.flat()
				.some(
					(movement: any) =>
						movement.goodType === 'planks' &&
						movement.provider === sawmill &&
						movement.demander === buildStorage
				)
			expect(
				movementAlreadyCreated || sawmill.hive.createMovement('planks', sawmill, buildStorage)
			).toBe(true)

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
			} as any

			const worker = engine.spawnCharacter('PlankWorker', { q: 0, r: 0 })
			worker.role = 'worker'
			void worker.scriptsContext
			const action = worker.findAction()
			if (action) worker.begin(action)

			expect(() => engine.tick(0.25)).not.toThrow()
			await flushDeferred()

			const trackedEntries = Array.from(sawmill.hive.movingGoods.entries())
			.filter((entry: unknown) => {
				const [, goods] = entry as [any, any[]]
				return goods.some((candidate: any) => candidate?.ref === movement.ref)
			})
			.map((entry: unknown) => {
				const [coord] = entry as [any, any[]]
				return axial.key(coord)
			})
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

		;(movement as any).claimed = true
		;(movement as any).claimedAtMs = Date.now() - 10_000
			;(sawmill.hive as any).removeMovementFromCoordTracking?.(movement)

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
			} as any

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
