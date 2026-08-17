// @ts-nocheck
import type { SaveState } from 'ssh/game'
import type { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import { isVehicleLineService } from 'ssh/population/vehicle/vehicle'
import { describe, expect, it } from 'vitest'
import { gatherFreightLine } from '../freight-fixtures'
import { TestEngine } from '../test-engine'

describe('dock registration survives save/load', () => {
	it('keeps a docked vehicle registered after a save/load round-trip', async () => {
		const engine = new TestEngine({ terrainSeed: 88, characterCount: 0 })
		const reloaded = new TestEngine({ terrainSeed: 88, characterCount: 0 })
		await engine.init()
		await reloaded.init()
		try {
			const line = gatherFreightLine({
				name: 'Dock save gather',
				hiveName: 'SaveHive',
				coord: [0, 0],
				filters: ['wood'],
				radius: 2,
			})
			engine.loadScenario({
				tiles: [{ coord: [0, 0], terrain: 'concrete' }],
				hives: [
					{ name: 'SaveHive', alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }] },
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)

			// Use the live line reference stored in `game.freightLines` (patches may normalize).
			const storedLine = engine.game.freightLines.find((l) => l.name === 'Dock save gather')!
			expect(storedLine).toBeDefined()
			const vehicle = engine.game.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 }, [
				storedLine,
			])
			// Load goods so the dock completion check does not immediately end the service.
			vehicle.storage.addGood('wood', 2)
			vehicle.beginLineService(storedLine, storedLine.stops[1]!)
			vehicle.dock()

			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content as FreightBayAlveolus
			expect(bay.hive.freightVehicleDockFor(vehicle)).toBeDefined()

			const saved = engine.game.saveGameData()
			await reloaded.game.loadGameData(saved)

			const reloadedVehicle = [...reloaded.game.vehicles][0]
			expect(reloadedVehicle).toBeDefined()
			expect(isVehicleLineService(reloadedVehicle.service)).toBe(true)
			expect(reloadedVehicle.isDocked).toBe(true)

			const reloadedBay = reloaded.game.hex.getTile({ q: 0, r: 0 })?.content as FreightBayAlveolus
			expect(reloadedBay).toBeDefined()
			expect(reloadedBay.hive.freightVehicleDockFor(reloadedVehicle)).toBeDefined()
		} finally {
			await engine.destroy()
			await reloaded.destroy()
		}
	})
})
