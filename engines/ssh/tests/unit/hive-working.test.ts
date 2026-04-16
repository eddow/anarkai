import type { SaveState } from 'ssh/game'
import { alveolusClass, Hive } from 'ssh/hive'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

async function flushHiveRefresh(engine: TestEngine) {
	engine.game.hex.flushHiveTopologyRefresh()
	await Promise.resolve()
	await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('Hive working and metadata preservation', () => {
	it('makes alveolus running depend on the parent hive working flag', async () => {
		const engine = new TestEngine({ terrainSeed: 11, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{ name: 'North', alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }] },
				],
			}
			engine.loadScenario(scenario)
			const gather = engine.game.hex.getTile({ q: 0, r: 0 })?.content as StorageAlveolus | undefined
			expect(gather).toBeDefined()
			expect(gather?.working).toBe(true)

			gather!.hive.working = false
			expect(gather?.working).toBe(false)

			gather!.working = true
			expect(gather?.working).toBe(false)

			gather!.hive.working = true
			expect(gather?.working).toBe(true)
		} finally {
			await engine.destroy()
		}
	})

	it('preserves working and regenerates names when a hive splits', async () => {
		const engine = new TestEngine({ terrainSeed: 12, characterCount: 0 })
		await engine.init()
		try {
			engine.loadScenario({
				hives: [
					{
						name: 'Chain',
						working: false,
						alveoli: [
							{ coord: [0, 0], alveolus: 'freight_bay', goods: {} },
							{ coord: [1, 0], alveolus: 'freight_bay', goods: {} },
							{ coord: [2, 0], alveolus: 'freight_bay', goods: {} },
						],
					},
				],
			})

			const middle = engine.game.hex.getTile({ q: 1, r: 0 })?.content as StorageAlveolus | undefined
			middle?.deconstruct()
			await flushHiveRefresh(engine)

			const left = engine.game.hex.getTile({ q: 0, r: 0 })?.content as StorageAlveolus | undefined
			const right = engine.game.hex.getTile({ q: 2, r: 0 })?.content as StorageAlveolus | undefined
			const hives = new Set([left?.hive, right?.hive])

			expect(hives.size).toBe(2)
			for (const hive of hives) {
				expect(hive?.working).toBe(false)
				expect(hive?.name).toMatch(/^Chain-[A-Z]$/)
			}
		} finally {
			await engine.destroy()
		}
	})

	it('keeps one source hive metadata when hives merge', async () => {
		const engine = new TestEngine({ terrainSeed: 13, characterCount: 0 })
		await engine.init()
		try {
			engine.loadScenario({
				hives: [
					{
						name: 'Alpha',
						working: false,
						alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }],
					},
					{
						name: 'Beta',
						working: true,
						alveoli: [{ coord: [2, 0], alveolus: 'freight_bay', goods: {} }],
					},
				],
			})

			const bridgeTile = engine.game.hex.getTile({ q: 1, r: 0 })!
			const BridgeAlveolus = alveolusClass.freight_bay
			expect(BridgeAlveolus).toBeDefined()
			const bridge = new BridgeAlveolus!(bridgeTile)
			engine.game.hex.setTileContent(bridgeTile, bridge)
			if (!bridge.hive) {
				const hive = Hive.for(bridgeTile)
				hive.attach(bridge)
			}

			expect(bridge.hive.name).toBe('Alpha')
			expect(bridge.hive.working).toBe(false)
			expect(
				(engine.game.hex.getTile({ q: 2, r: 0 })?.content as StorageAlveolus | undefined)?.hive
			).toBe(bridge.hive)
		} finally {
			await engine.destroy()
		}
	})

	it('serializes and restores hive working state', async () => {
		const engine = new TestEngine({ terrainSeed: 14, characterCount: 0 })
		await engine.init()
		try {
			engine.loadScenario({
				hives: [
					{
						name: 'Saved Hive',
						working: false,
						alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }],
					},
				],
			})
			const saved = engine.game.saveGameData()
			expect(saved.hives?.[0]?.working).toBe(false)
			expect(saved.hives?.[0]?.name).toBe('Saved Hive')

			const restored = new TestEngine({ terrainSeed: 14, characterCount: 0 })
			await restored.init()
			try {
				await restored.game.loadGameData(saved)
				const gather = restored.game.hex.getTile({ q: 0, r: 0 })?.content as
					| StorageAlveolus
					| undefined
				expect(gather?.hive.name).toBe('Saved Hive')
				expect(gather?.hive.working).toBe(false)
				expect(gather?.working).toBe(false)
			} finally {
				await restored.destroy()
			}
		} finally {
			await engine.destroy()
		}
	})
})
