import { traces } from 'ssh/debug'
import type { SaveState } from 'ssh/game'
import { axial } from 'ssh/utils'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

async function flushDeferred(turns: number = 3) {
	for (let i = 0; i < turns; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0))
	}
}

describe('Convey bookkeeping border handoff', () => {
	// Skipped: running this test alone triggers Vitest 3.2 worker RPC stack overflow while
	// postMessage-serializing task results (likely reactive logistics graphs). Keep the body for
	// local debugging; re-enable when Vitest fixes serialization or the scenario is refactored.
	it.skip('does not discard a border movement during a transient source handoff gap', {
		timeout: 20000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		const originalAdvertisingTrace = traces.advertising

		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'PlankBorderTransientSourceHive',
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

			const movement = selection.movement
			movement.claimed = true
			sawmill.hive.fulfillMovementSource(movement, 'test.border.pickup')
			const hop = movement.hop()
			expect(hop).toBeDefined()
			movement.place()

			const borderStorage = sawmill.hive.storageAt(hop)
			expect(borderStorage).toBeDefined()
			if (!borderStorage) throw new Error('Expected border storage to exist')

			const publishedSource = borderStorage.reserve(
				{ [movement.goodType]: 1 },
				{
					type: 'convey.path',
					goodType: movement.goodType,
					movementId: movement._mgId,
					providerRef: movement.provider,
					demanderRef: movement.demander,
					providerName: movement.provider.name,
					demanderName: movement.demander.name,
					movement,
				}
			)
			expect(publishedSource).toBeDefined()
			if (!publishedSource) throw new Error('Expected published source allocation')

			movement.allocations.source = publishedSource
			movement.claimed = false
			delete movement.claimedAtMs
			delete movement.claimedBy

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

			publishedSource.cancel()
			void storage.aGoodMovement

			movement.allocations.source = borderStorage.reserve(
				{ [movement.goodType]: 1 },
				{
					type: 'convey.path',
					goodType: movement.goodType,
					movementId: movement._mgId,
					providerRef: movement.provider,
					demanderRef: movement.demander,
					providerName: movement.provider.name,
					demanderName: movement.demander.name,
					movement,
				}
			)

			await flushDeferred()

			const trackedEntries = Array.from(sawmill.hive.movingGoods.entries())
				.filter(([, goods]: [any, any[]]) =>
					goods.some((candidate) => candidate._mgId === movement._mgId)
				)
				.map(([coord]: [any, any[]]) => axial.key(coord))

			expect(trackedEntries).toContain(axial.key(hop))
			expect(warnings.some((warning) => warning.includes('[WATCHDOG] Broken movement'))).toBe(false)
		} finally {
			traces.advertising = originalAdvertisingTrace
			await engine.destroy()
		}
	})
})
