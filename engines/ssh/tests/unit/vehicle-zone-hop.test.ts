import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import {
	type FreightStop,
	type FreightZoneDefinitionRadius,
	normalizeFreightLineDefinition,
} from 'ssh/freight/freight-line'
import {
	aggregateHiveNeedTypes,
	gatherZoneLoadStopForBay,
	pickGatherTargetInZoneStop,
} from 'ssh/freight/freight-zone-gather-target'
import { migrateV1FiltersToGoodsSelection } from 'ssh/freight/goods-selection-policy'
import { freightStopMovementTarget, previewInitialVehicleService } from 'ssh/freight/vehicle-run'
import {
	findVehicleBeginServiceJob,
	findVehicleHopJob,
	findZoneBrowseJob,
} from 'ssh/freight/vehicle-work'
import type { GamePatches } from 'ssh/game/game'
import { Game } from 'ssh/game/game'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { isVehicleOffloadService } from 'ssh/population/vehicle/vehicle'
import { axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import { afterEach, describe, expect, it } from 'vitest'
import { gatherFreightLine } from '../freight-fixtures'
import { bindOperatedWheelbarrowOffload } from '../test-engine/vehicle-bind'

const woodOnly = migrateV1FiltersToGoodsSelection(['wood'])

function freightBayAnchor(hiveName: string, coord: readonly [number, number]) {
	return {
		kind: 'alveolus' as const,
		hiveName,
		alveolusType: 'freight_bay' as const,
		coord,
	}
}

describe('Vehicle zone hop semantics', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('boarding binds maintenance offload service until line beginService attaches route', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				gatherFreightLine({
					id: 'VH:test-gather',
					name: 'Test gather',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		}
		game = new Game({ terrainSeed: 9401, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('v1', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('Test', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()

		expect(character.driving).toBe(true)
		expect(isVehicleOffloadService(vehicle.service)).toBe(true)
	})

	it('falls back to the zone center when no downstream utility makes a loose-good target actionable', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [2, 0] as const, terrain: 'grass' as const },
			],
			hives: [
				{
					name: 'HiveVH',
					alveoli: [{ coord: [0, 0] as const, alveolus: 'freight_bay', goods: {} }],
				},
			],
			looseGoods: [{ goodType: 'wood' as const, position: { q: 2, r: 0 } }],
			freightLines: [
				gatherFreightLine({
					id: 'HiveVH:implicit-gather:0,0',
					name: 'Gather',
					hiveName: 'HiveVH',
					coord: [0, 0],
					filters: ['wood'],
					radius: 3,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9402, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const gather = game.hex.getTile({ q: 0, r: 0 })?.content as StorageAlveolus
		const line = game.freightLines.find((l) => l.id === 'HiveVH:implicit-gather:0,0')!
		const zoneStop = gatherZoneLoadStopForBay(line, gather)
		expect(zoneStop).toBeDefined()

		const hiveNeeds = aggregateHiveNeedTypes(game)
		const zStop = zoneStop! as FreightStop & { zone: FreightZoneDefinitionRadius }
		const pick = pickGatherTargetInZoneStop(game, line, zStop, gather.tile.position, hiveNeeds, {
			bayAlveolus: gather,
		})
		expect(pick?.path.length).toBeGreaterThan(0)
		const dest = pick!.path[pick!.path.length - 1]!
		const destKey = axial.key(toAxialCoord(dest)!)
		expect(destKey).toBe(axial.key({ q: 2, r: 0 }))

		const character = game.population.createCharacter('Hop', { q: 0, r: 0 })
		const vehicle = game.vehicles.createVehicle('vh-wheel', 'wheelbarrow', { q: 0, r: 0 }, [line])
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()

		const target = freightStopMovementTarget(game, character, line, zStop)
		expect(target).toBeDefined()
		const targetKey = axial.key(toAxialCoord(target!)!)
		expect(targetKey).toBe(axial.key({ q: 0, r: 0 }))
	})

	it('previewInitialVehicleService matches ensureVehicleServiceStarted first stop', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				gatherFreightLine({
					id: 'VH:preview',
					name: 'Preview',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		}
		game = new Game({ terrainSeed: 9403, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('pv', 'wheelbarrow', { q: 0, r: 0 })
		vehicle.servedLines = [game.freightLines[0]!]
		const preview = previewInitialVehicleService(vehicle)
		expect(preview?.line.id).toBe(game.freightLines[0]!.id)
		expect(preview?.stop.id).toBeDefined()
	})

	it('offers vehicleHop with needsBeginService before line-hop when only offload service is bound', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				gatherFreightLine({
					id: 'VH:begin',
					name: 'Begin',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		}
		game = new Game({ terrainSeed: 9404, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('vb', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('Begin', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()

		const begin = findVehicleBeginServiceJob(game, character)
		expect(begin?.job).toBe('vehicleHop')
		expect(begin?.needsBeginService).toBe(true)
		expect(findVehicleHopJob(game, character)).toEqual(begin)
	})

	it('does not offer zoneBrowse on the current zone stop when downstream utility says no further load is needed', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [2, 0] as const, terrain: 'grass' as const },
			],
			freightLines: [
				gatherFreightLine({
					id: 'VH:zone-browse',
					name: 'Zone browse',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 3,
				}),
			],
			hives: [
				{ name: 'H', alveoli: [{ coord: [0, 0] as const, alveolus: 'freight_bay', goods: {} }] },
			],
			looseGoods: [{ goodType: 'wood' as const, position: { q: 2, r: 0 } }],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9405, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const zoneStop = line.stops[0]!
		const vehicle = game.vehicles.createVehicle('vz', 'wheelbarrow', { q: 1, r: 0 }, [line])
		const character = game.population.createCharacter('Browse', { q: 1, r: 0 })
		vehicle.beginLineService(line, zoneStop, character)
		character.operates = vehicle
		character.onboard()

		expect(findZoneBrowseJob(game, character)).toBeUndefined()
	})

	it('zoneBrowse does not offer provide work when current cargo is reserved for later stops', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
				{ coord: [2, 0] as const, terrain: 'grass' as const },
				{ coord: [3, 0] as const, terrain: 'grass' as const },
			],
			hives: [
				{ name: 'A', alveoli: [{ coord: [0, 0] as const, alveolus: 'freight_bay', goods: {} }] },
				{ name: 'B', alveoli: [{ coord: [2, 0] as const, alveolus: 'freight_bay', goods: {} }] },
			],
			freightLines: [
				normalizeFreightLineDefinition({
					id: 'VH:dist-zone',
					name: 'Distribute zone',
					stops: [
						{
							id: 'load-a',
							loadSelection: woodOnly,
							anchor: freightBayAnchor('A', [0, 0]),
						},
						{
							id: 'current-zone',
							zone: { kind: 'radius', center: [1, 0] as const, radius: 1 },
						},
						{
							id: 'load-b',
							loadSelection: woodOnly,
							anchor: freightBayAnchor('B', [2, 0]),
						},
						{
							id: 'future-zone',
							zone: { kind: 'radius', center: [3, 0] as const, radius: 1 },
						},
					],
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9406, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const currentSiteTile = game.hex.getTile({ q: 1, r: 0 })!
		currentSiteTile.content = new BuildDwelling(currentSiteTile, 'basic_dwelling')
		const futureSiteTile = game.hex.getTile({ q: 3, r: 0 })!
		futureSiteTile.content = new BuildDwelling(futureSiteTile, 'basic_dwelling')

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('vd', 'wheelbarrow', { q: 1, r: 0 }, [line])
		const character = game.population.createCharacter('Distribute', { q: 1, r: 0 })
		vehicle.beginLineService(line, line.stops[1]!, character)
		character.operates = vehicle
		character.onboard()

		vehicle.storage.addGood('wood', 1)
		expect(findZoneBrowseJob(game, character)).toBeUndefined()
	})
})
