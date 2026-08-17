// @ts-nocheck
import { createConstructionShell, finalizeConstructionShell } from 'ssh/construction-shell'
import { createConstructionSiteState } from 'ssh/construction-state'
import type { SaveState } from 'ssh/game'
import { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import { describe, expect, it } from 'vitest'
import { gatherFreightLine } from '../freight-fixtures'
import { TestEngine } from '../test-engine'

describe('dock registration when bay completes construction', () => {
	it('registers once the under-construction bay becomes a FreightBayAlveolus', async () => {
		const engine = new TestEngine({ terrainSeed: 68, characterCount: 0 })
		await engine.init()
		try {
			const line = gatherFreightLine({
				name: 'UC gather',
				hiveName: 'UC',
				coord: [0, 0],
				filters: ['wood'],
				radius: 2,
			})
			// Bay tile starts empty (no bay yet) — the line still points at it.
			engine.loadScenario({
				tiles: [{ coord: [0, 0], terrain: 'concrete' }],
				freightLines: [line],
			} satisfies Partial<SaveState>)

			const tile = engine.game.hex.getTile({ q: 0, r: 0 })!
			// Place a construction shell targeting freight_bay (the bay is being built).
			const site = createConstructionSiteState({
				kind: 'alveolus',
				alveolusType: 'freight_bay',
			})
			const shell = createConstructionShell(tile, site)
			tile.content = shell

			const storedLine = engine.game.freightLines.find((l) => l.name === 'UC gather')!
			const vehicle = engine.game.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 }, [
				storedLine,
			])
			vehicle.storage.addGood('wood', 2)
			vehicle.beginLineService(storedLine, storedLine.stops[1]!)
			vehicle.dock()

			expect(vehicle.isDocked).toBe(true)
			// The vehicle is docked, but there is no bay yet → no registration.
			expect((tile.content as FreightBayAlveolus).hive).toBeUndefined()

			// Finalize construction → tile becomes a real FreightBayAlveolus.
			finalizeConstructionShell(tile.content)

			const bay = tile.content as FreightBayAlveolus
			expect(bay).toBeInstanceOf(FreightBayAlveolus)
			// The docked vehicle must now be registered at the completed bay.
			expect(bay.hive.freightVehicleDockFor(vehicle)).toBeDefined()
		} finally {
			await engine.destroy()
		}
	})
})
