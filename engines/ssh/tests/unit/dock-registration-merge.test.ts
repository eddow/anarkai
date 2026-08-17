// @ts-nocheck
import type { SaveState } from 'ssh/game'
import { createAlveolus } from 'ssh/hive'
import type { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import { describe, expect, it } from 'vitest'
import { gatherFreightLine } from '../freight-fixtures'
import { TestEngine } from '../test-engine'

async function flushHiveRefresh(engine: TestEngine) {
	engine.game.hex.flushHiveTopologyRefresh()
	await Promise.resolve()
	await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('dock registration survives hive merge', () => {
	it('keeps a dock registered when its bay hive is the non-primary source of a merge', async () => {
		const engine = new TestEngine({ terrainSeed: 55, characterCount: 0 })
		await engine.init()
		try {
			const line = gatherFreightLine({
				name: 'Merge dock gather',
				hiveName: 'RightHive',
				coord: [2, 0],
				filters: ['wood'],
				radius: 2,
			})
			engine.loadScenario({
				tiles: [
					{ coord: [0, 0], terrain: 'concrete' },
					{ coord: [2, 0], terrain: 'concrete' },
				],
				hives: [
					{
						name: 'LeftHive',
						alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }],
					},
					{
						name: 'RightHive',
						alveoli: [{ coord: [2, 0], alveolus: 'freight_bay', goods: {} }],
					},
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)

			const storedLine = engine.game.freightLines.find((l) => l.name === 'Merge dock gather')!
			const vehicle = engine.game.vehicles.createVehicle('wheelbarrow', { q: 2, r: 0 }, [
				storedLine,
			])
			vehicle.storage.addGood('wood', 2)
			vehicle.beginLineService(storedLine, storedLine.stops[1]!)
			vehicle.dock()

			const rightBay = engine.game.hex.getTile({ q: 2, r: 0 })?.content as FreightBayAlveolus
			expect(rightBay.hive.freightVehicleDockFor(vehicle)).toBeDefined()

			// Build a bridge alveolus at [1,0] to merge LeftHive and RightHive.
			const bridgeTile = engine.game.hex.getTile({ q: 1, r: 0 })!
			const bridge = createAlveolus('freight_bay', bridgeTile)
			if (!bridge) throw new Error('bridge alveolus missing')
			bridgeTile.content = bridge
			await flushHiveRefresh(engine)

			const mergedBay = engine.game.hex.getTile({ q: 2, r: 0 })?.content as FreightBayAlveolus
			// The dock must survive the merge even though RightHive was not the
			// metadata-primary source hive.
			expect(mergedBay.hive.freightVehicleDockFor(vehicle)).toBeDefined()
		} finally {
			await engine.destroy()
		}
	})
})
