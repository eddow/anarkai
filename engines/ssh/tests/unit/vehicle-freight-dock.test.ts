import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { namedTrace, traces } from 'ssh/dev/debug'
import type { FreightLineDefinition } from 'ssh/freight/freight-line'
import { normalizeFreightLineDefinition } from 'ssh/freight/freight-line'
import { migrateV1FiltersToGoodsSelection } from 'ssh/freight/goods-selection-policy'
import {
	collectDockedVehicleAdvertisementCandidates,
	dockedVehicleGoodsRelations,
} from 'ssh/freight/vehicle-freight-dock'
import { maybeAdvanceVehicleFromCompletedAnchorStop } from 'ssh/freight/vehicle-run'
import { findVehicleHopJob, findVehicleOffloadJob } from 'ssh/freight/vehicle-work'
import type { SaveState } from 'ssh/game'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { isVehicleLineService } from 'ssh/population/vehicle/vehicle'
import { describe, expect, it } from 'vitest'
import { gatherFreightLine } from '../freight-fixtures'
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
			if (!isVehicleLineService(vehicle.service)) throw new Error('expected line service')
			vehicle.service.docked = true
			vehicle.position = undefined

			const relations = dockedVehicleGoodsRelations(vehicle, bay!)
			const candidates = collectDockedVehicleAdvertisementCandidates(vehicle, bay!)

			expect(relations.berries?.advertisement).toBe('provide')
			expect(relations.berries?.priority).toBe('2-use')
			expect(relations.wood?.advertisement).toBe('demand')
			expect(relations.wood?.priority).toBe('2-use')
			expect(candidates).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ goodType: 'berries', advertisement: 'provide', quantity: 1 }),
					expect.objectContaining({ goodType: 'wood', advertisement: 'demand', quantity: 1 }),
				])
			)
			for (const candidate of candidates) {
				expect(candidate.score).toBeGreaterThan(0)
			}
		} finally {
			await engine.destroy()
		}
	})

	it('creates a convey unload from a docked gather vehicle into its own gather-only bay', async () => {
		const engine = new TestEngine({ terrainSeed: 12008, characterCount: 0 })
		await engine.init()
		try {
			const line = gatherFreightLine({
				id: 'dock:gather-unload',
				name: 'Dock gather unload',
				hiveName: 'DockGather',
				coord: [0, 0],
				filters: ['wood'],
				radius: 2,
			})
			engine.loadScenario({
				hives: [
					{
						name: 'DockGather',
						alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }],
					},
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)

			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content as StorageAlveolus | undefined
			expect(bay).toBeDefined()
			expect(bay?.canTake('wood', '2-use')).toBe(false)

			const vehicle = engine.game.vehicles.createVehicle(
				'dock-gather-v',
				'wheelbarrow',
				{ q: 0, r: 0 },
				[line]
			)
			vehicle.storage.addGood('wood', 1)
			vehicle.beginLineService(line, line.stops[1]!)
			if (!isVehicleLineService(vehicle.service)) throw new Error('expected line service')
			vehicle.dock()
			expect(vehicle.position).toBeUndefined()
			expect(vehicle.effectiveTile.uid).toBe(bay?.tile.uid)
			expect(bay?.hive.freightVehicleDockFor(vehicle.uid)).toBeDefined()
			await new Promise((resolve) => setTimeout(resolve, 10))

			const worker = engine.game.population.createCharacter('DockConvey', { q: 0, r: 0 })
			expect(bay?.getJob(worker)?.job).toBe('convey')
		} finally {
			await engine.destroy()
		}
	})

	it('ends an empty final dock halt and exposes a park job once dock work is drained', async () => {
		const engine = new TestEngine({ terrainSeed: 12009, characterCount: 0 })
		await engine.init()
		try {
			const line = gatherFreightLine({
				id: 'dock:gather-finished',
				name: 'Dock gather finished',
				hiveName: 'DockDone',
				coord: [0, 0],
				filters: ['wood'],
				radius: 2,
			})
			engine.loadScenario({
				tiles: [
					{ coord: [0, 0], terrain: 'concrete' },
					{ coord: [1, 0], terrain: 'grass' },
				],
				hives: [
					{
						name: 'DockDone',
						alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }],
					},
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)

			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content as StorageAlveolus | undefined
			expect(bay).toBeDefined()
			const vehicle = engine.game.vehicles.createVehicle(
				'dock-finished-v',
				'wheelbarrow',
				{ q: 0, r: 0 },
				[line]
			)
			vehicle.beginLineService(line, line.stops[1]!)
			vehicle.dock()
			expect(vehicle.position).toBeUndefined()
			expect(vehicle.effectiveTile.uid).toBe(bay?.tile.uid)
			expect(bay?.hive.freightVehicleDockFor(vehicle.uid)).toBeDefined()
			await new Promise((resolve) => setTimeout(resolve, 10))

			const worker = engine.game.population.createCharacter('DockFinishConvey', { q: 0, r: 0 })
			const previousVehicleTrace = traces.vehicle
			const vehicleTrace = namedTrace('vehicle', { silent: true })
			traces.vehicle = vehicleTrace
			try {
				maybeAdvanceVehicleFromCompletedAnchorStop(engine.game, vehicle, worker)
			} finally {
				traces.vehicle = previousVehicleTrace
			}

			expect(vehicle.service).toBeUndefined()
			expect(vehicle.position && { q: vehicle.position.q, r: vehicle.position.r }).toEqual({
				q: 0,
				r: 0,
			})
			expect(bay?.hive.freightVehicleDockFor(vehicle.uid)).toBeUndefined()
			const traceDump = vehicleTrace.read()
			expect(traceDump).toContain('vehicleJob.dock.complete')
			expect(traceDump).not.toContain('not-alveolus-tile')
			const park = findVehicleOffloadJob(engine.game, worker)
			expect(park?.job).toBe('vehicleOffload')
			expect(park?.maintenanceKind).toBe('park')
		} finally {
			await engine.destroy()
		}
	})

	it('advances a non-final drained dock halt so the next hop is offered', async () => {
		const engine = new TestEngine({ terrainSeed: 12010, characterCount: 0 })
		await engine.init()
		try {
			const line: FreightLineDefinition = normalizeFreightLineDefinition({
				id: 'dock:continue',
				name: 'Dock continue',
				stops: [
					{ id: 'current', anchor: freightBayAnchor('DockContinueA', [0, 0]) },
					{ id: 'next', anchor: freightBayAnchor('DockContinueB', [1, 0]) },
				],
			})
			engine.loadScenario({
				tiles: [
					{ coord: [0, 0], terrain: 'concrete' },
					{ coord: [1, 0], terrain: 'concrete' },
				],
				hives: [
					{
						name: 'DockContinueA',
						alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }],
					},
					{
						name: 'DockContinueB',
						alveoli: [{ coord: [1, 0], alveolus: 'freight_bay', goods: {} }],
					},
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)

			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content as StorageAlveolus | undefined
			expect(bay).toBeDefined()
			const vehicle = engine.game.vehicles.createVehicle(
				'dock-continue-v',
				'wheelbarrow',
				{ q: 0, r: 0 },
				[line]
			)
			vehicle.beginLineService(line, line.stops[0]!)
			vehicle.dock()
			expect(vehicle.position).toBeUndefined()
			const worker = engine.game.population.createCharacter('DockContinueWorker', { q: 0, r: 0 })

			maybeAdvanceVehicleFromCompletedAnchorStop(engine.game, vehicle, worker)

			expect(isVehicleLineService(vehicle.service)).toBe(true)
			if (!isVehicleLineService(vehicle.service)) throw new Error('expected line service')
			expect(vehicle.service.stop.id).toBe('next')
			expect(vehicle.service.docked).toBe(false)
			expect(vehicle.position && { q: vehicle.position.q, r: vehicle.position.r }).toEqual({
				q: 0,
				r: 0,
			})
			const hop = findVehicleHopJob(engine.game, worker)
			expect(hop?.job).toBe('vehicleHop')
			expect(hop?.stopId).toBe('next')
		} finally {
			await engine.destroy()
		}
	})
})
