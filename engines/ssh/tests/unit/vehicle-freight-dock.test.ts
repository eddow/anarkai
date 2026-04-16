import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import type { FreightLineDefinition } from 'ssh/freight/freight-line'
import { normalizeFreightLineDefinition } from 'ssh/freight/freight-line'
import { migrateV1FiltersToGoodsSelection } from 'ssh/freight/goods-selection-policy'
import { dockedVehicleGoodsRelations } from 'ssh/freight/vehicle-freight-dock'
import type { SaveState } from 'ssh/game'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

const woodOnly = migrateV1FiltersToGoodsSelection(['wood'])

function freightBayAnchor(hiveName: string, coord: readonly [number, number]) {
	return {
		kind: 'alveolus' as const,
		hiveName,
		alveolusType: 'freight_bay' as const,
		coord,
	}
}

describe('vehicle-freight-dock', () => {
	it('can provide surplus cargo while demanding downstream-needed goods at the same dock', async () => {
		const engine = new TestEngine({ terrainSeed: 12007, characterCount: 0 })
		await engine.init()
		try {
			const line: FreightLineDefinition = normalizeFreightLineDefinition({
				id: 'dock:mixed',
				name: 'Dock mixed',
				stops: [
					{ id: 'current', loadSelection: woodOnly, anchor: freightBayAnchor('A', [0, 0]) },
					{ id: 'future-load', loadSelection: woodOnly, anchor: freightBayAnchor('B', [2, 0]) },
					{ id: 'future-need', zone: { kind: 'radius', center: [4, 0], radius: 1 } },
				],
			})
			engine.loadScenario({
				hives: [
					{ name: 'A', alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: { wood: 1 } }] },
					{ name: 'B', alveoli: [{ coord: [2, 0], alveolus: 'freight_bay', goods: { wood: 1 } }] },
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)

			for (const coord of [
				{ q: 4, r: 0 },
				{ q: 5, r: 0 },
			]) {
				const tile = engine.game.hex.getTile(coord)!
				tile.content = new BuildDwelling(tile, 'basic_dwelling')
			}

			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content as StorageAlveolus | undefined
			expect(bay).toBeDefined()
			expect((bay?.storage.hasRoom('berries') ?? 0) > 0).toBe(true)

			const vehicle = engine.game.vehicles.createVehicle('dock-v', 'wheelbarrow', { q: 0, r: 0 }, [
				line,
			])
			vehicle.storage.addGood('berries', 1)
			vehicle.beginLineService(line, line.stops[0]!)
			vehicle.dock()

			const relations = dockedVehicleGoodsRelations(vehicle, bay!)

			expect(relations.berries?.advertisement).toBe('provide')
			expect(relations.berries?.priority).toBe('2-use')
			expect(relations.wood?.advertisement).toBe('demand')
			expect(relations.wood?.priority).toBe('2-use')
		} finally {
			await engine.destroy()
		}
	})
})
