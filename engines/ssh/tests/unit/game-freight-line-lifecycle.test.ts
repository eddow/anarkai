// @ts-nocheck
import { createExplicitFreightLineDraftForFreightBay } from 'ssh/freight/freight-line'
import type { SaveState } from 'ssh/game'
import { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('Game freight line lifecycle', () => {
	it('removes an explicit line by object reference', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{ name: 'HiveX', alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }] },
				],
			}
			engine.loadScenario(scenario)
			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content
			expect(bay).toBeInstanceOf(FreightBayAlveolus)
			const freightBay = bay as FreightBayAlveolus
			const draft = createExplicitFreightLineDraftForFreightBay(
				{ hive: freightBay.hive, name: 'freight_bay', tile: freightBay.tile },
				'distribute'
			)
			expect(draft).toBeDefined()
			engine.game.addFreightLine(draft!)
			const line = [...engine.game.freightLines].find((entry: any) => entry.name === draft!.name)!
			const before = engine.game.freightLines.size
			expect(engine.game.removeFreightLine(line)).toBe(true)
			expect(engine.game.freightLines.size).toBe(before - 1)
		} finally {
			await engine.destroy()
		}
	})

	it('assigns a vehicle to a freight line', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		try {
			engine.loadScenario({
				hives: [{ name: 'H', alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }] }],
			})
			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content as FreightBayAlveolus
			const draft = createExplicitFreightLineDraftForFreightBay(
				{ hive: bay.hive, name: 'freight_bay', tile: bay.tile },
				'distribute'
			)!
			engine.game.addFreightLine(draft)
			const line = [...engine.game.freightLines].find((entry: any) => entry.name === draft.name)!
			const vehicle = engine.game.vehicles.createVehicle('wheelbarrow', { q: 2, r: 0 })
			engine.game.assignVehicleToFreightLine(vehicle, line)
			expect(vehicle.servedLines.map((entry) => entry.name)).toContain(line.name)
		} finally {
			await engine.destroy()
		}
	})
})
