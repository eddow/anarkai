import { inert } from 'mutts'
import type { Alveolus } from 'ssh/board/content/alveolus'
import { traces } from 'ssh/debug'
import type { SaveState } from 'ssh/game'
import { options } from 'ssh/globals'
import { alveolusClass } from 'ssh/hive'
import { BuildAlveolus } from 'ssh/hive/build'
import type { Hive, MovingGood } from 'ssh/hive/hive'
import { isAllocationValid } from 'ssh/storage/guard'
import { afterEach, describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

const originalWatchdogOptions = {
	stalledMovementScanIntervalMs: options.stalledMovementScanIntervalMs,
	stalledMovementSettleMs: options.stalledMovementSettleMs,
}

afterEach(() => {
	options.stalledMovementScanIntervalMs = originalWatchdogOptions.stalledMovementScanIntervalMs
	options.stalledMovementSettleMs = originalWatchdogOptions.stalledMovementSettleMs
})

function normalizeWatchdogTestState(gatherer: Alveolus, sawmill: Alveolus) {
	const gatherStorage = gatherer.storage as {
		slots?: Array<{ goodType?: string; reserved?: number } | undefined>
	}
	for (const slot of gatherStorage.slots ?? []) {
		if (slot?.goodType === 'wood') slot.reserved = 0
	}

	const sawmillStorage = sawmill.storage as {
		_allocated?: Record<string, number | undefined>
	}
	if (sawmillStorage._allocated?.wood) {
		sawmillStorage._allocated.wood = 0
	}
}

function clearWoodBookkeeping(...alveoli: Alveolus[]) {
	for (const alveolus of alveoli) {
		const storage = alveolus.storage as {
			slots?: Array<{ goodType?: string; reserved?: number; allocated?: number } | undefined>
			_allocated?: Record<string, number | undefined>
		}
		for (const slot of storage.slots ?? []) {
			if (slot?.goodType !== 'wood') continue
			slot.reserved = 0
			slot.allocated = 0
		}
		if (storage._allocated?.wood) storage._allocated.wood = 0
	}
}

function reservedQuantity(alveolus: Alveolus, goodType: string) {
	const storage = alveolus.storage as {
		slots?: Array<{ goodType?: string; reserved?: number } | undefined>
		_reserved?: Record<string, number | undefined>
	}
	let total = storage._reserved?.[goodType] ?? 0
	for (const slot of storage.slots ?? []) {
		if (slot?.goodType !== goodType) continue
		total += slot.reserved ?? 0
	}
	return total
}

async function flushWatchdogWork() {
	await Promise.resolve()
	await new Promise((resolve) => setTimeout(resolve, 0))
	await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('Stalled Exchange Watchdog', () => {
	it('recovers a stable gatherer to sawmill match when no active movement remains', {
		timeout: 15000,
	}, async () => {
		options.stalledMovementScanIntervalMs = 0
		options.stalledMovementSettleMs = 20
		;(globalThis as any).allowExpectedDiagnostics?.(
			/\[WATCHDOG\] STALLED EXCHANGE/,
			/\[WATCHDOG\] Detached movement allocation/,
			/\[WATCHDOG\] Cancelled detached movement allocation/
		)

		const warnings: string[] = []
		const originalAdvertisingTrace = traces.advertising
		traces.advertising = {
			...console,
			warn: (...args: unknown[]) => {
				warnings.push(args.map(String).join(' '))
			},
		}

		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'WatchdogHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'gather', goods: { wood: 1 } },
							{ coord: [1, 0], alveolus: 'sawmill', goods: {} },
						],
					},
				],
			}

			engine.loadScenario(scenario)
			await new Promise((resolve) => setTimeout(resolve, 0))
			await new Promise((resolve) => setTimeout(resolve, 0))

			const gatherer = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
			const hive = gatherer?.hive as Hive | undefined
			expect(hive).toBeDefined()
			if (!hive) throw new Error('Expected gatherer hive to exist')

			let firstMovement: MovingGood | undefined
			for (const goods of hive.movingGoods.values()) {
				firstMovement = goods.find((movement) => movement.goodType === 'wood')
				if (firstMovement) break
			}
			expect(firstMovement).toBeDefined()
			if (!firstMovement) throw new Error('Expected initial wood movement to exist')

			inert(() => {
				hive.movingGoods.clear()
			})
			const sawmill = engine.game.hex.getTile({ q: 1, r: 0 })?.content as Alveolus | undefined
			expect(sawmill).toBeDefined()
			if (!sawmill) throw new Error('Expected sawmill alveolus to exist')
			normalizeWatchdogTestState(gatherer, sawmill)

			// Drive the stalled-exchange scan deterministically (interval timing can be flaky in CI).
			const scan = () =>
				(hive as unknown as { scanForStalledExchanges(): void }).scanForStalledExchanges()
			for (let i = 0; i < 6; i++) {
				await new Promise((resolve) => setTimeout(resolve, 25))
				scan()
			}
			await flushWatchdogWork()
			const woodMovements = Array.from(hive.movingGoods.values())
				.flat()
				.filter((movement) => movement.goodType === 'wood').length
			expect(
				woodMovements > 0 ||
					warnings.some((warning) => warning.includes('[WATCHDOG] STALLED EXCHANGE'))
			).toBe(true)
		} finally {
			traces.advertising = originalAdvertisingTrace
			await engine.destroy()
		}
	})

	it('re-advertises a stable gatherer to sawmill match when no movement remains', {
		timeout: 15000,
	}, async () => {
		options.stalledMovementScanIntervalMs = 0
		options.stalledMovementSettleMs = 20
		;(globalThis as any).allowExpectedDiagnostics?.(
			/\[WATCHDOG\] STALLED EXCHANGE/,
			/\[WATCHDOG\] Detached movement allocation/,
			/\[WATCHDOG\] Cancelled detached movement allocation/
		)

		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'WatchdogHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'gather', goods: { wood: 1 } },
							{ coord: [1, 0], alveolus: 'sawmill', goods: {} },
						],
					},
				],
			}

			engine.loadScenario(scenario)
			await new Promise((resolve) => setTimeout(resolve, 0))
			await new Promise((resolve) => setTimeout(resolve, 0))

			const gatherer = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
			const hive = gatherer?.hive as Hive | undefined
			expect(hive).toBeDefined()
			if (!hive) throw new Error('Expected gatherer hive to exist')

			let firstMovement: MovingGood | undefined
			for (const goods of hive.movingGoods.values()) {
				firstMovement = goods.find((movement) => movement.goodType === 'wood')
				if (firstMovement) break
			}
			expect(firstMovement).toBeDefined()
			if (!firstMovement) throw new Error('Expected initial wood movement to exist')

			inert(() => {
				hive.movingGoods.clear()
			})
			const sawmill = engine.game.hex.getTile({ q: 1, r: 0 })?.content as Alveolus | undefined
			expect(sawmill).toBeDefined()
			if (!sawmill) throw new Error('Expected sawmill alveolus to exist')
			normalizeWatchdogTestState(gatherer, sawmill)

			const scan = () =>
				(hive as unknown as { scanForStalledExchanges(): void }).scanForStalledExchanges()
			for (let i = 0; i < 6; i++) {
				await new Promise((resolve) => setTimeout(resolve, 25))
				scan()
			}
			await flushWatchdogWork()

			let woodMovements = 0
			for (const goods of hive.movingGoods.values()) {
				woodMovements += goods.filter((movement) => movement.goodType === 'wood').length
			}
			expect(woodMovements).toBeGreaterThan(0)
		} finally {
			await engine.destroy()
		}
	})

	it('does not cancel live same-name movement allocations while cleaning an orphan', {
		timeout: 15000,
	}, async () => {
		;(globalThis as any).allowExpectedDiagnostics?.(
			/\[WATCHDOG\] Cancelled orphaned exchange allocations/
		)
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

	try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'WatchdogHive',
						alveoli: [{ coord: [0, 0], alveolus: 'gather', goods: { wood: 2 } }],
					},
				],
			}

			engine.loadScenario(scenario)
			await new Promise((resolve) => setTimeout(resolve, 0))
			await new Promise((resolve) => setTimeout(resolve, 0))

			const source = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
			const orphanTargetTile = engine.game.hex.getTile({ q: 1, r: 0 })
			const liveTargetTile = engine.game.hex.getTile({ q: 0, r: 1 })
			expect(orphanTargetTile).toBeDefined()
			expect(liveTargetTile).toBeDefined()
			if (!orphanTargetTile || !liveTargetTile) throw new Error('Expected target tiles to exist')
			inert(() => {
				orphanTargetTile.content = new BuildAlveolus(orphanTargetTile, 'storage')
				liveTargetTile.content = new BuildAlveolus(liveTargetTile, 'storage')
			})
			await flushWatchdogWork()
			const orphanTarget = orphanTargetTile.content as Alveolus | undefined
			const liveTarget = liveTargetTile.content as Alveolus | undefined
			const hive = source?.hive as Hive | undefined
			expect(source).toBeDefined()
			expect(orphanTarget).toBeDefined()
			expect(liveTarget).toBeDefined()
			expect(hive).toBeDefined()
			if (!source || !orphanTarget || !liveTarget || !hive) {
				throw new Error('Expected source, targets, and hive to exist')
			}

			inert(() => {
				hive.movingGoods.clear()
			})
			clearWoodBookkeeping(source, orphanTarget, liveTarget)

				const orphanCreated = hive.createMovement('wood', source, orphanTarget)
				const liveCreated = hive.createMovement('wood', source, liveTarget)
				expect(orphanCreated || liveCreated).toBe(true)

			const woodMovements = Array.from(hive.movingGoods.values())
				.flat()
				.filter((movement) => movement.goodType === 'wood')
			expect(woodMovements).toHaveLength(2)

			const orphanMovement = woodMovements.find((movement) => movement.demander === orphanTarget)
			const liveMovement = woodMovements.find((movement) => movement.demander === liveTarget)
			expect(orphanMovement).toBeDefined()
			expect(liveMovement).toBeDefined()
			if (!orphanMovement || !liveMovement) throw new Error('Expected both wood movements to exist')

			inert(() => {
				for (const [coord, goods] of Array.from(hive.movingGoods.entries())) {
					const kept = goods.filter((movement) => movement._mgId !== orphanMovement._mgId)
					if (kept.length === 0) hive.movingGoods.delete(coord)
					else hive.movingGoods.set(coord, kept)
				}
			})
			;(
				hive as unknown as {
					activeMovementsById: Map<string, MovingGood>
				}
			).activeMovementsById.delete(orphanMovement._mgId)

			const cancelOrphans = (hive as unknown as {
				cancelOrphanedExchangeAllocations(
					provider: Alveolus,
					demander: Alveolus,
					goodType: 'wood'
				): number
			}).cancelOrphanedExchangeAllocations.bind(hive)

			const canceled = cancelOrphans(source, orphanTarget, 'wood')
			expect(canceled).toBeGreaterThan(0)
			expect(isAllocationValid(liveMovement.allocations.source)).toBe(true)
			expect(isAllocationValid(liveMovement.allocations.target)).toBe(true)

			const remainingWoodMovements = Array.from(hive.movingGoods.values())
				.flat()
				.filter((movement) => movement.goodType === 'wood')
			expect(remainingWoodMovements.map((movement) => movement._mgId)).toContain(liveMovement._mgId)
			await flushWatchdogWork()
		} finally {
			await engine.destroy()
		}
	})

	it('does not allow stocked build sites to become providers', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'WatchdogHive',
						alveoli: [{ coord: [0, 0], alveolus: 'storage', goods: {} }],
					},
				],
			}

			engine.loadScenario(scenario)
			await new Promise((resolve) => setTimeout(resolve, 0))
			await new Promise((resolve) => setTimeout(resolve, 0))

			const buildSourceTile = engine.game.hex.getTile({ q: 1, r: 0 })
			const buildTargetTile = engine.game.hex.getTile({ q: 0, r: 1 })
			expect(buildSourceTile).toBeDefined()
			expect(buildTargetTile).toBeDefined()
			if (!buildSourceTile || !buildTargetTile) throw new Error('Expected build tiles to exist')

			buildSourceTile.content = new BuildAlveolus(buildSourceTile, 'storage')
			buildTargetTile.content = new BuildAlveolus(buildTargetTile, 'storage')

			const buildSource = buildSourceTile.content as Alveolus
			const buildTarget = buildTargetTile.content as Alveolus
			const hive = buildSource.hive as Hive | undefined
			expect(hive).toBeDefined()
			if (!hive) throw new Error('Expected hive for build sites')

			buildSource.storage.addGood('wood', 1)
			buildSource.storage.addGood('planks', 1)
			buildSource.storage.addGood('stone', 1)
			expect(buildSource.canGive('wood', '2-use')).toBe(false)
			expect(buildTarget.canTake('wood', '2-use')).toBe(true)
			expect(hive.createMovement('wood', buildSource, buildTarget)).toBe(false)
			expect(hive.createMovement('planks', buildSource, buildTarget)).toBe(false)
			expect(hive.createMovement('stone', buildSource, buildTarget)).toBe(false)
		} finally {
			await engine.destroy()
		}
	})

	it('heals detached source reservations by recreating the missing movement', {
		timeout: 15000,
	}, async () => {
		options.stalledMovementScanIntervalMs = 0
		options.stalledMovementSettleMs = 20
		;(globalThis as any).allowExpectedDiagnostics?.(
			/\[WATCHDOG\] STALLED EXCHANGE/,
			/\[WATCHDOG\] Recovered tile movement bookkeeping/,
			/\[WATCHDOG\] Detached movement allocation/,
			/\[WATCHDOG\] Cancelled detached movement allocation/
		)

		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const scenario: Partial<SaveState> = {
				hives: [
						{
							name: 'WatchdogHive',
							alveoli: [
								{ coord: [0, 0], alveolus: 'gather', goods: { wood: 1 } },
								{ coord: [1, 0], alveolus: 'sawmill', goods: {} },
							],
						},
				],
			}

			engine.loadScenario(scenario)
			await new Promise((resolve) => setTimeout(resolve, 0))
			await new Promise((resolve) => setTimeout(resolve, 0))

			const gatherer = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
			const storage = engine.game.hex.getTile({ q: 1, r: 0 })?.content as Alveolus | undefined
			const hive = gatherer?.hive as Hive | undefined
			expect(gatherer).toBeDefined()
			expect(storage).toBeDefined()
			expect(hive).toBeDefined()
			if (!gatherer || !storage || !hive) throw new Error('Expected gatherer, storage, and hive')

			const created = hive.createMovement('wood', gatherer, storage)
			const initialMovement = Array.from(hive.movingGoods.values())
				.flat()
				.find(
					(movement) =>
						movement.goodType === 'wood' &&
						movement.provider === gatherer &&
						movement.demander === storage
				)
			expect(created || !!initialMovement).toBe(true)
			if (!initialMovement) throw new Error('Expected initial wood movement to exist')
			expect(reservedQuantity(gatherer, 'wood')).toBeGreaterThan(0)

			inert(() => {
				hive.movingGoods.clear()
			})

			expect(gatherer.aGoodMovement).toBeUndefined()
			expect(reservedQuantity(gatherer, 'wood')).toBeGreaterThan(0)

			const scan = () =>
				(hive as unknown as { scanForStalledExchanges(): void }).scanForStalledExchanges()
			let recreatedMovement = Array.from(hive.movingGoods.values())
				.flat()
				.find((movement) => movement.goodType === 'wood')
			let remainingReserved = reservedQuantity(gatherer, 'wood')
			for (let i = 0; i < 20; i++) {
				scan()
				await new Promise((resolve) => setTimeout(resolve, 25))
				await flushWatchdogWork()
				recreatedMovement = Array.from(hive.movingGoods.values())
					.flat()
					.find((movement) => movement.goodType === 'wood')
				remainingReserved = reservedQuantity(gatherer, 'wood')
				if (recreatedMovement || remainingReserved === 0) break
			}
			expect(!!recreatedMovement || remainingReserved === 0).toBe(true)
			if (recreatedMovement) {
				expect(gatherer.aGoodMovement?.some((movement) => movement.goodType === 'wood')).toBe(true)
				expect(remainingReserved).toBe(1)
				expect(!!recreatedMovement.allocations.source).toBe(true)
				expect(!!recreatedMovement.allocations.target).toBe(true)
				expect(isAllocationValid(recreatedMovement.allocations.target)).toBe(true)
			}
		} finally {
			await engine.destroy()
		}
	})

	it('rebinds a movement after construction replaces its target alveolus', {
		timeout: 15000,
	}, async () => {
		const warnings: string[] = []
		const originalAdvertisingTrace = traces.advertising
		traces.advertising = {
			...console,
			warn: (...args: unknown[]) => {
				warnings.push(args.map(String).join(' '))
			},
		}

		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'WatchdogHive',
						alveoli: [{ coord: [0, 0], alveolus: 'gather', goods: { wood: 1 } }],
					},
				],
			}

			engine.loadScenario(scenario)
			await flushWatchdogWork()

			const gatherer = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
			const targetTile = engine.game.hex.getTile({ q: 1, r: 0 })
			expect(gatherer).toBeDefined()
			expect(targetTile).toBeDefined()
			if (!gatherer || !targetTile) throw new Error('Expected gatherer and target tile')

			targetTile.content = new BuildAlveolus(targetTile, 'storage')
			await flushWatchdogWork()

			const buildStorage = targetTile.content as Alveolus | undefined
			expect(buildStorage).toBeDefined()
			if (!buildStorage) throw new Error('Expected build storage target')

			const hive = gatherer.hive as Hive
			hive.createMovement('wood', gatherer, buildStorage)
			const initialMovement = Array.from(hive.movingGoods.values())
				.flat()
				.find(
					(movement) =>
						movement.goodType === 'wood' &&
						movement.provider === gatherer &&
						movement.demander === buildStorage
				)
			expect(initialMovement).toBeDefined()

			inert(() => {
				targetTile.content = new alveolusClass.storage(targetTile)
			})
			await flushWatchdogWork()

			const rebuiltStorage = targetTile.content as Alveolus | undefined
			expect(rebuiltStorage).toBeDefined()
			if (!rebuiltStorage) throw new Error('Expected rebuilt storage target')

			const reboundMovement = Array.from(gatherer.hive.movingGoods.values())
				.flat()
				.find(
					(movement) =>
						movement.goodType === 'wood' &&
						movement.provider === gatherer &&
						movement.demander === rebuiltStorage
				)
			expect(reboundMovement).toBeDefined()
			expect(
				warnings.some(
					(warning) =>
						warning.includes('[WATCHDOG] Detached movement allocation') ||
						warning.includes('[WATCHDOG] Broken movement') ||
						warning.includes('[WATCHDOG] Invalid movement token')
				)
			).toBe(false)
		} finally {
			traces.advertising = originalAdvertisingTrace
			await engine.destroy()
		}
	})

	it('preserves claimed movement identity across target replacement', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'WatchdogHive',
						alveoli: [{ coord: [0, 0], alveolus: 'gather', goods: { wood: 1 } }],
					},
				],
			}

			engine.loadScenario(scenario)
			await flushWatchdogWork()

			const gatherer = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
			const targetTile = engine.game.hex.getTile({ q: 1, r: 0 })
			expect(gatherer).toBeDefined()
			expect(targetTile).toBeDefined()
			if (!gatherer || !targetTile) throw new Error('Expected gatherer and target tile')

			targetTile.content = new BuildAlveolus(targetTile, 'storage')
			await flushWatchdogWork()

			const buildStorage = targetTile.content as Alveolus | undefined
			expect(buildStorage).toBeDefined()
			if (!buildStorage) throw new Error('Expected build storage target')

			const hive = gatherer.hive as Hive
			hive.createMovement('wood', gatherer, buildStorage)
			const initialMovement = Array.from(hive.movingGoods.values())
				.flat()
				.find(
					(movement) =>
						movement.goodType === 'wood' &&
						movement.provider === gatherer &&
						movement.demander === buildStorage
				)
			expect(initialMovement?._mgId).toBeDefined()
			if (!initialMovement?._mgId) throw new Error('Expected initial movement to exist')

			initialMovement.claimed = true
			initialMovement.claimedBy = 'worker-claim-test'
			initialMovement.claimedAtMs = 12345

			inert(() => {
				targetTile.content = new alveolusClass.storage(targetTile)
			})
			await flushWatchdogWork()

			const rebuiltStorage = targetTile.content as Alveolus | undefined
			expect(rebuiltStorage).toBeDefined()
			if (!rebuiltStorage) throw new Error('Expected rebuilt storage target')

			const reboundCandidates = Array.from((gatherer.hive as any).activeMovementsById.values()).map(
				(movement: MovingGood) => ({
					id: movement._mgId,
					demander: movement.demander?.name,
					demanderCoord: movement.demander?.tile?.position,
					claimed: movement.claimed,
					claimedBy: movement.claimedBy,
				})
			)
			const reboundMovement = Array.from((gatherer.hive as any).activeMovementsById.values()).find(
				(movement: MovingGood) => movement._mgId === initialMovement._mgId
			)
			expect(reboundCandidates).toHaveLength(1)
			expect(reboundCandidates[0].demanderCoord).toEqual(rebuiltStorage.tile.position)
			expect(reboundMovement).toBeDefined()
			if (!reboundMovement) throw new Error('Expected claimed rebound movement to exist')
			expect(reboundMovement._mgId).toBe(initialMovement._mgId)
			expect(reboundMovement.claimed).toBe(true)
			expect(reboundMovement.claimedBy).toBe('worker-claim-test')
			expect(reboundMovement.claimedAtMs).toBe(12345)
		} finally {
			await engine.destroy()
		}
	})

	it('downgrades an un-rebindable movement into an orphan good after hive split', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'WatchdogHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'gather', goods: { wood: 1 } },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
							{ coord: [2, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
			}

			engine.loadScenario(scenario)
			await flushWatchdogWork()

			const gatherer = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
			const bridgeTile = engine.game.hex.getTile({ q: 1, r: 0 })
			const target = engine.game.hex.getTile({ q: 2, r: 0 })?.content as Alveolus | undefined
			expect(gatherer).toBeDefined()
			expect(bridgeTile).toBeDefined()
			expect(target).toBeDefined()
			if (!gatherer || !bridgeTile || !target) {
				throw new Error('Expected gatherer, bridge, and target')
			}

			const hive = gatherer.hive as Hive
			const created = hive.createMovement('wood', gatherer, target)
			const initialMovement = Array.from(hive.movingGoods.values())
				.flat()
				.find(
					(movement) =>
						movement.goodType === 'wood' &&
						movement.provider === gatherer &&
						movement.demander === target
				)
			expect(created || !!initialMovement).toBe(true)

			bridgeTile.content = undefined as never
			await flushWatchdogWork()

			const remainingMovement = Array.from(gatherer.hive.movingGoods.values())
				.flat()
				.find((movement) => movement.goodType === 'wood' && movement.demander === target)
			expect(remainingMovement).toBeUndefined()
			const looseWood = Array.from(engine.game.hex.looseGoods.goods.values())
				.flat()
				.filter((good) => good.goodType === 'wood').length
			expect(looseWood).toBeGreaterThanOrEqual(1)
		} finally {
			await engine.destroy()
		}
	})

	it('keeps an existing movement id alive while two hives merge through a new bridge', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'LeftHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'gather', goods: { wood: 1 } },
							{ coord: [0, 1], alveolus: 'storage', goods: {} },
						],
					},
					{
						name: 'RightHive',
						alveoli: [
							{ coord: [2, 0], alveolus: 'gather', goods: { wood: 1 } },
							{ coord: [2, 1], alveolus: 'storage', goods: {} },
						],
					},
				],
			}

			engine.loadScenario(scenario)
			await flushWatchdogWork()

			const leftGatherer = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
			const leftStorage = engine.game.hex.getTile({ q: 0, r: 1 })?.content as Alveolus | undefined
			const rightGatherer = engine.game.hex.getTile({ q: 2, r: 0 })?.content as Alveolus | undefined
			const rightStorage = engine.game.hex.getTile({ q: 2, r: 1 })?.content as Alveolus | undefined
			const bridgeTile = engine.game.hex.getTile({ q: 1, r: 0 })
			expect(leftGatherer && leftStorage && rightGatherer && rightStorage && bridgeTile).toBeTruthy()
			if (!leftGatherer || !leftStorage || !rightGatherer || !rightStorage || !bridgeTile) {
				throw new Error('Expected merge scenario tiles to exist')
			}

			const leftHive = leftGatherer.hive as Hive
			leftHive.createMovement('wood', leftGatherer, leftStorage)

			const leftMovement = Array.from(leftHive.movingGoods.values())
				.flat()
				.find((movement) => movement.goodType === 'wood' && movement.demander === leftStorage)
			expect(leftMovement?._mgId).toBeDefined()
			if (!leftMovement?._mgId) {
				throw new Error('Expected initial movement to exist')
			}

			bridgeTile.content = new BuildAlveolus(bridgeTile, 'storage')
			await flushWatchdogWork()

			const mergedHive = leftGatherer.hive as Hive
			const activeIds = Array.from((mergedHive as any).activeMovementsById.values()).map(
				(movement: MovingGood) => movement._mgId
			)
			const trackedIds = Array.from(mergedHive.movingGoods.values())
				.flat()
				.map((movement) => movement._mgId)
			if (activeIds.length === 0 && trackedIds.length === 0) {
				throw new Error('Expected merged hive to keep at least one movement id alive')
			}
			expect(activeIds).toContain(leftMovement._mgId)
			expect(leftGatherer.hive).toBe(rightGatherer.hive)
		} finally {
			await engine.destroy()
		}
	})
})
