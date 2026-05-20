import {
	createExplicitFreightLineDraftForFreightBay,
	isImplicitGatherFreightLineId,
} from 'ssh/freight/freight-line'
import type { SaveState } from 'ssh/game'
import { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import { isVehicleLineService } from 'ssh/population/vehicle/vehicle'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('Game freight line lifecycle', () => {
	it('refuses to remove implicit gather freight line ids', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [{ name: 'H', alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }] }],
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
				hives: [
					{ name: 'HiveX', alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }] },
				],
			}
			engine.loadScenario(scenario)
			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content
			expect(bay).toBeInstanceOf(FreightBayAlveolus)
			const freightBay = bay as FreightBayAlveolus
			const draft = createExplicitFreightLineDraftForFreightBay(
				{
					hive: freightBay.hive,
					name: 'freight_bay',
					tile: freightBay.tile,
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

	it('assigns, unassigns, refreshes, and serializes freight-line vehicle assignments', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		try {
			engine.loadScenario({
				hives: [{ name: 'H', alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }] }],
			})
			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content as FreightBayAlveolus
			const line = createExplicitFreightLineDraftForFreightBay(
				{ hive: bay.hive, name: 'freight_bay', tile: bay.tile },
				'distribute'
			)!
			engine.game.replaceFreightLine(line)
			const vehicle = engine.game.vehicles.createVehicle('assign-wb', 'wheelbarrow', { q: 2, r: 0 })

			expect(engine.game.assignVehicleToFreightLine(vehicle.uid, line.id)).toBe(true)
			expect(engine.game.assignVehicleToFreightLine(vehicle.uid, line.id)).toBe(false)
			expect(vehicle.servedLines.map((entry) => entry.id)).toEqual([line.id])
			expect(vehicle.serialize().servedLineIds).toEqual([line.id])

			const renamed = { ...line, name: 'Renamed material line' }
			engine.game.replaceFreightLine(renamed)
			expect(vehicle.servedLines[0]?.name).toBe('Renamed material line')

			expect(engine.game.unassignVehicleFromFreightLine(vehicle.uid, line.id)).toBe(true)
			expect(vehicle.servedLines).toEqual([])
		} finally {
			await engine.destroy()
		}
	})

	it('does not teleport a docked vehicle when editing its active halt to another bay', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		try {
			engine.loadScenario({
				hives: [
					{
						name: 'H',
						alveoli: [
							{ coord: [0, 0], alveolus: 'freight_bay', goods: {} },
							{ coord: [3, 0], alveolus: 'freight_bay', goods: {} },
						],
					},
				],
			})
			const line = {
				id: 'editable-line',
				name: 'Editable line',
				stops: [
					{
						id: 'bay-stop',
						anchor: {
							kind: 'alveolus' as const,
							hiveName: 'H',
							alveolusType: 'freight_bay' as const,
							coord: [0, 0] as const,
						},
					},
				],
			}
			engine.game.replaceFreightLine(line)
			const activeLine = engine.game.freightLines.find((entry) => entry.id === line.id)!
			const vehicle = engine.game.vehicles.createVehicle('refresh-docked-wb', 'wheelbarrow', {
				q: 0,
				r: 0,
			})
			vehicle.beginLineService(activeLine, activeLine.stops[0]!)
			vehicle.dock()
			expect(vehicle.isDocked).toBe(true)

			engine.game.replaceFreightLine({
				...activeLine,
				stops: [
					{
						id: 'bay-stop',
						anchor: {
							kind: 'alveolus' as const,
							hiveName: 'H',
							alveolusType: 'freight_bay' as const,
							coord: [3, 0] as const,
						},
					},
				],
			})

			expect(vehicle.isDocked).toBe(false)
			expect(vehicle.position).toMatchObject({ q: 0, r: 0 })
			expect(isVehicleLineService(vehicle.service) && vehicle.service.stop.anchor.coord).toEqual([
				3, 0,
			])
		} finally {
			await engine.destroy()
		}
	})

	it('removes deleted freight lines from assigned vehicles', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		try {
			engine.loadScenario({
				hives: [{ name: 'H', alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }] }],
			})
			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content as FreightBayAlveolus
			const line = createExplicitFreightLineDraftForFreightBay(
				{ hive: bay.hive, name: 'freight_bay', tile: bay.tile },
				'distribute'
			)!
			engine.game.replaceFreightLine(line)
			const vehicle = engine.game.vehicles.createVehicle('remove-wb', 'wheelbarrow', { q: 2, r: 0 })
			engine.game.assignVehicleToFreightLine(vehicle.uid, line.id)

			expect(engine.game.removeFreightLineById(line.id)).toBe(true)
			expect(vehicle.servedLines).toEqual([])
		} finally {
			await engine.destroy()
		}
	})
})
