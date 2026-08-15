// @ts-nocheck
import type { SaveState } from 'ssh/game'
import type { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { describe, expect, it } from 'vitest'
import { gatherFreightLine } from '../freight-fixtures'
import { TestEngine } from '../test-engine'

async function flushHiveRefresh(engine: TestEngine) {
	engine.game.hex.flushHiveTopologyRefresh()
	await Promise.resolve()
	await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('dock registration survives hive split', () => {
	it('keeps a dock registered on its bay hive after a split', async () => {
		const engine = new TestEngine({ terrainSeed: 67, characterCount: 0 })
		await engine.init()
		try {
			const line = gatherFreightLine({
				name: 'Split dock gather',
				hiveName: 'SplitHive',
				coord: [0, 0],
				filters: ['wood'],
				radius: 2,
			})
			engine.loadScenario({
				tiles: [
					{ coord: [0, 0], terrain: 'concrete' },
					{ coord: [1, 0], terrain: 'concrete' },
					{ coord: [2, 0], terrain: 'concrete' },
				],
				hives: [
					{
						name: 'SplitHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'freight_bay', goods: {} },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
							{ coord: [2, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)

			const storedLine = engine.game.freightLines.find((l) => l.name === 'Split dock gather')!
			const vehicle = engine.game.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 }, [storedLine])
			vehicle.storage.addGood('wood', 2)
			vehicle.beginLineService(storedLine, storedLine.stops[1]!)
			vehicle.dock()

			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content as FreightBayAlveolus
			expect(bay.hive.freightVehicleDockFor(vehicle)).toBeDefined()

			// Split the hive by deconstructing the bridge storage at [1,0].
			const bridge = engine.game.hex.getTile({ q: 1, r: 0 })?.content as StorageAlveolus
			bridge.deconstruct()
			await flushHiveRefresh(engine)

			const splitBay = engine.game.hex.getTile({ q: 0, r: 0 })?.content as FreightBayAlveolus
			expect(splitBay.hive.freightVehicleDockFor(vehicle)).toBeDefined()
		} finally {
			await engine.destroy()
		}
	})
})
