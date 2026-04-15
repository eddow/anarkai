import {
	createExplicitFreightLineDraftForFreightBay,
	isImplicitGatherFreightLineId,
} from 'ssh/freight/freight-line'
import type { SaveState } from 'ssh/game'
import { StorageAlveolus } from 'ssh/hive/storage'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('Game freight line lifecycle', () => {
	it('refuses to remove implicit gather freight line ids', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [{ name: 'H', alveoli: [{ coord: [0, 0], alveolus: 'gather', goods: {} }] }],
			}
			engine.loadScenario(scenario)
			const implicit = engine.game.freightLines.find((l) => isImplicitGatherFreightLineId(l.id))
			expect(implicit).toBeDefined()
			expect(engine.game.removeFreightLineById(implicit!.id)).toBe(false)
			expect(engine.game.freightLines.some((l) => l.id === implicit!.id)).toBe(true)
		} finally {
			await engine.destroy()
		}
	})

	it('removes an explicit line by id and keeps implicit lines', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [{ name: 'HiveX', alveoli: [{ coord: [0, 0], alveolus: 'gather', goods: {} }] }],
			}
			engine.loadScenario(scenario)
			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content
			expect(bay).toBeInstanceOf(StorageAlveolus)
			const storage = bay as StorageAlveolus
			const draft = createExplicitFreightLineDraftForFreightBay(
				{
					hive: storage.hive,
					name: 'freight_bay',
					tile: storage.tile,
				},
				'distribute'
			)
			expect(draft).toBeDefined()
			engine.game.replaceFreightLine(draft!)
			const before = engine.game.freightLines.length
			expect(engine.game.removeFreightLineById(draft!.id)).toBe(true)
			expect(engine.game.freightLines.length).toBe(before - 1)
			expect(engine.game.freightLines.some((l) => l.id === draft!.id)).toBe(false)
			expect(engine.game.freightLines.some((l) => isImplicitGatherFreightLineId(l.id))).toBe(true)
		} finally {
			await engine.destroy()
		}
	})
})
