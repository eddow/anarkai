// @ts-nocheck

import { unwrap } from 'mutts'
import { namedTrace, traces } from 'ssh/dev/debug'
import { ensureFreightVehicleDockRegistration } from 'ssh/freight/vehicle-freight-dock-sync'
import type { SaveState } from 'ssh/game'
import type { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import { describe, expect, it } from 'vitest'
import { gatherFreightLine } from '../freight-fixtures'
import { TestEngine } from '../test-engine'

describe('dock registration proxy/raw identity', () => {
	it('finds the dock via both proxy and raw identity after dock()', async () => {
		const engine = new TestEngine({ terrainSeed: 90, characterCount: 0 })
		await engine.init()
		try {
			const line = gatherFreightLine({
				name: 'Identity gather',
				hiveName: 'IdentityHive',
				coord: [0, 0],
				filters: ['wood'],
				radius: 2,
			})
			engine.loadScenario({
				tiles: [{ coord: [0, 0], terrain: 'concrete' }],
				hives: [
					{
						name: 'IdentityHive',
						alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }],
					},
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)

			const storedLine = [...engine.game.freightLines].find((l) => l.name === 'Identity gather')!
			const vehicle = engine.game.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 }, [
				storedLine,
			])
			vehicle.storage.addGood('wood', 2)
			vehicle.beginLineService(storedLine, storedLine.stops[1]!)
			vehicle.dock()

			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content as FreightBayAlveolus

			// Both the proxy (planner path) and raw (Vehicle.dock `this`) must resolve.
			expect(bay.hive.freightVehicleDockFor(vehicle)).toBeDefined()
			expect(bay.hive.freightVehicleDockFor(unwrap(vehicle))).toBeDefined()

			// The planner's ensure must NOT think the registration is missing.
			const previousTrace = traces.vehicle
			const vehicleTrace = namedTrace('vehicle', { silent: true })
			traces.vehicle = vehicleTrace
			try {
				expect(ensureFreightVehicleDockRegistration(vehicle)).toBe(bay)
				expect(ensureFreightVehicleDockRegistration(unwrap(vehicle))).toBe(bay)
			} finally {
				traces.vehicle = previousTrace
			}
			const dump = vehicleTrace.read()
			expect(dump).not.toContain('repairing missing dock registration')
		} finally {
			await engine.destroy()
		}
	})
})
