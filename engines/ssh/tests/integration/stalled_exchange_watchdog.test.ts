import type { Alveolus } from 'ssh/board/content/alveolus'
import { traces } from 'ssh/debug'
import type { SaveState } from 'ssh/game'
import { options } from 'ssh/globals'
import type { Hive, MovingGood } from 'ssh/hive/hive'
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

describe('Stalled Exchange Watchdog', () => {
	it('warns when a stable gatherer to sawmill match has no active movement', {
		timeout: 15000,
	}, async () => {
		options.stalledMovementScanIntervalMs = 20
		options.stalledMovementSettleMs = 20

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

			firstMovement.allocations.source.cancel()
			firstMovement.allocations.target.cancel()
			hive.movingGoods.clear()

			// Drive the stalled-exchange scan deterministically (interval timing can be flaky in CI).
			const scan = () =>
				(hive as unknown as { scanForStalledExchanges(): void }).scanForStalledExchanges()
			for (let i = 0; i < 6; i++) {
				await new Promise((resolve) => setTimeout(resolve, 25))
				scan()
			}
			expect(warnings.some((warning) => warning.includes('[WATCHDOG] STALLED EXCHANGE'))).toBe(true)
		} finally {
			traces.advertising = originalAdvertisingTrace
			await engine.destroy()
		}
	})

	it('re-advertises a stable gatherer to sawmill match when no movement remains', {
		timeout: 15000,
	}, async () => {
		options.stalledMovementScanIntervalMs = 20
		options.stalledMovementSettleMs = 20

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

			firstMovement.allocations.source.cancel()
			firstMovement.allocations.target.cancel()
			hive.movingGoods.clear()

			let woodMovements = 0
			for (const goods of hive.movingGoods.values()) {
				woodMovements += goods.filter((movement) => movement.goodType === 'wood').length
			}
			expect(woodMovements).toBe(0)

			const scan = () =>
				(hive as unknown as { scanForStalledExchanges(): void }).scanForStalledExchanges()
			for (let i = 0; i < 6; i++) {
				await new Promise((resolve) => setTimeout(resolve, 25))
				scan()
			}
			await new Promise((resolve) => setTimeout(resolve, 0))

			woodMovements = 0
			for (const goods of hive.movingGoods.values()) {
				woodMovements += goods.filter((movement) => movement.goodType === 'wood').length
			}
			expect(woodMovements).toBeGreaterThan(0)
		} finally {
			await engine.destroy()
		}
	})
})
