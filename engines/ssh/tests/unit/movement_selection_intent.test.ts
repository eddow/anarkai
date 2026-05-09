import type { Hive } from 'ssh/hive/hive'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('movement selection pending intents', () => {
	it('does not select the same source good twice before deferred reservations run', async () => {
		const engine = new TestEngine({ terrainSeed: 12021, characterCount: 0 })
		await engine.init()
		try {
			engine.loadScenario({
				hives: [
					{
						name: 'IntentHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: { wood: 1 } },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
							{ coord: [0, 1], alveolus: 'storage', goods: {} },
						],
					},
				],
			})

			const provider = engine.game.hex.getTile({ q: 0, r: 0 })?.content as StorageAlveolus
			const firstTarget = engine.game.hex.getTile({ q: 1, r: 0 })?.content as StorageAlveolus
			const secondTarget = engine.game.hex.getTile({ q: 0, r: 1 })?.content as StorageAlveolus
			const hive = provider.hive as Hive

			let first: StorageAlveolus | undefined
			let second: StorageAlveolus | undefined
			hive.postStep(() => {
				first = hive.selectMovement('provide', provider, [firstTarget], 'wood', '2-use', '0-store')
				second = hive.selectMovement(
					'provide',
					provider,
					[secondTarget],
					'wood',
					'2-use',
					'0-store'
				)
			})

			expect(first).toBe(firstTarget)
			expect(second).toBeUndefined()
			const activeMovements = (hive as unknown as { collectActiveMovements(): unknown[] })
				.collectActiveMovements()
				.filter(
					(movement) =>
						(movement as { provider?: unknown; goodType?: unknown }).provider === provider &&
						(movement as { goodType?: unknown }).goodType === 'wood'
				)
			expect(activeMovements).toHaveLength(1)
		} finally {
			await engine.destroy()
		}
	})
})
