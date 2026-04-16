import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { traces } from 'ssh/debug'
import {
	assertDockedSemantics,
	assertVehicleServiceOperator,
	traceVehicleStockWithoutService,
} from 'ssh/freight/vehicle-invariants'
import {
	pickInitialVehicleServiceCandidate,
	projectedLineStopForVehicleHop,
} from 'ssh/freight/vehicle-run'
import {
	findProvideFromVehicleJob,
	findUnloadFromVehicleJob,
	findVehicleBeginServiceJob,
} from 'ssh/freight/vehicle-work'
import type { GamePatches } from 'ssh/game/game'
import { Game } from 'ssh/game/game'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { VehicleFunctions } from 'ssh/npcs/context/vehicle'
import { subject } from 'ssh/npcs/scripts'
import { DurationStep } from 'ssh/npcs/steps'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { distributeFreightLine, gatherFreightLine } from '../freight-fixtures'
import {
	bindOperatedWheelbarrowLine,
	bindOperatedWheelbarrowOffload,
} from '../test-engine/vehicle-bind'

describe('Vehicle begin-service arbitration', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('pickInitialVehicleServiceCandidate prefers the served line whose first stop is closest', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [8, 0] as const, terrain: 'grass' as const },
			],
			freightLines: [
				gatherFreightLine({
					id: 'arb:far',
					name: 'Far gather',
					hiveName: 'H',
					coord: [8, 0],
					filters: ['wood'],
					radius: 2,
				}),
				gatherFreightLine({
					id: 'arb:near',
					name: 'Near gather',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9501, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const far = game.freightLines.find((l) => l.id === 'arb:far')!
		const near = game.freightLines.find((l) => l.id === 'arb:near')!
		const vehicle = game.vehicles.createVehicle('arb-v', 'wheelbarrow', { q: 0, r: 0 }, [far, near])
		const character = game.population.createCharacter('Arb', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()

		const pick = pickInitialVehicleServiceCandidate(game, character, vehicle)
		expect(pick?.line.id).toBe('arb:near')

		const job = findVehicleBeginServiceJob(game, character)
		expect(job?.lineId).toBe(near.id)
		expect(job?.stopId).toBeDefined()
	})

	it('findProvideFromVehicleJob offers vehicle stock to a standalone build site on the same tile', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				gatherFreightLine({
					id: 'pv:gather',
					name: 'Pv gather',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9502, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const siteTile = game.hex.getTile({ q: 0, r: 0 })!
		siteTile.content = new BuildDwelling(siteTile, 'basic_dwelling')

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('pv', 'wheelbarrow', { q: 0, r: 0 }, [line])
		vehicle.storage.addGood('wood', 4)

		const character = game.population.createCharacter('Prov', { q: 0, r: 0 })
		bindOperatedWheelbarrowLine(game, character, vehicle)
		character.onboard()

		const job = findProvideFromVehicleJob(game, character)
		expect(job?.job).toBe('zoneBrowse')
		expect(job?.zoneBrowseAction).toBe('provide')
		expect(job?.goodType).toBe('wood')
		expect(job!.quantity).toBeGreaterThan(0)
	})

	it('traces.vehicle debug when provideFromVehicle applies without line service (offload-only)', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9503, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const siteTile = game.hex.getTile({ q: 0, r: 0 })!
		siteTile.content = new BuildDwelling(siteTile, 'basic_dwelling')

		const vehicle = game.vehicles.createVehicle('pv-tr', 'wheelbarrow', { q: 0, r: 0 })
		vehicle.storage.addGood('wood', 2)

		const character = game.population.createCharacter('Trace', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()

		const log = vi.fn()
		const prev = traces.vehicle
		traces.vehicle = {
			debug: vi.fn(),
			error: vi.fn(),
			info: vi.fn(),
			log,
			warn: vi.fn(),
		} as unknown as typeof console
		try {
			findProvideFromVehicleJob(game, character)
			expect(log).toHaveBeenCalledWith('vehicleJob.provideFromVehicle.skippedNoLineService', {
				vehicleUid: 'pv-tr',
			})
		} finally {
			traces.vehicle = prev
		}
	})

	it('traceVehicleStockWithoutService logs when stock exists without line service', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9504, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('v-stock', 'wheelbarrow', { q: 0, r: 0 })
		vehicle.storage.addGood('wood', 1)

		const log = vi.fn()
		const prev = traces.vehicle
		traces.vehicle = {
			debug: vi.fn(),
			error: vi.fn(),
			info: vi.fn(),
			log,
			warn: vi.fn(),
		} as unknown as typeof console
		try {
			traceVehicleStockWithoutService(vehicle)
			expect(log).toHaveBeenCalledWith('vehicle has stock without active service', 'v-stock')
		} finally {
			traces.vehicle = prev
		}
	})

	it('pickInitialVehicleServiceCandidate tie-breaks equal distance by vehicle stock matching line goods', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				gatherFreightLine({
					id: 'arb:berries',
					name: 'Berries gather',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['berries'],
					radius: 2,
				}),
				gatherFreightLine({
					id: 'arb:wood',
					name: 'Wood gather',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9505, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const berries = game.freightLines.find((l) => l.id === 'arb:berries')!
		const wood = game.freightLines.find((l) => l.id === 'arb:wood')!
		const vehicle = game.vehicles.createVehicle('arb-tie', 'wheelbarrow', { q: 0, r: 0 }, [
			berries,
			wood,
		])
		vehicle.storage.addGood('wood', 1)
		const character = game.population.createCharacter('Tie', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()

		const pick = pickInitialVehicleServiceCandidate(game, character, vehicle)
		expect(pick?.line.id).toBe('arb:wood')
	})

	it('findVehicleBeginServiceJob is undefined when only a distribute line has no construction demand in range', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'concrete' as const }],
			freightLines: [
				distributeFreightLine({
					id: 'arb:dist-only',
					name: 'Distribute only',
					hiveName: 'Solo',
					coord: [0, 0],
					filters: ['wood'],
					unloadRadius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9506, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('arb-dist', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('NoSite', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()

		expect(findVehicleBeginServiceJob(game, character)).toBeUndefined()
	})

	it('unloadFromVehicleStep moves goods into bay storage and keeps operator invariants', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'concrete' as const }],
			hives: [
				{
					name: 'UnloadHive',
					alveoli: [{ coord: [0, 0], alveolus: 'freight_bay' }],
				},
			],
			freightLines: [
				gatherFreightLine({
					id: 'arb:unload',
					name: 'Unload gather',
					hiveName: 'UnloadHive',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9507, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const unloadStop = line.stops[1]!
		const vehicle = game.vehicles.createVehicle('arb-ul', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('Unload', { q: 0, r: 0 })
		vehicle.beginService(line, unloadStop, character)
		vehicle.storage.addGood('wood', 2)
		character.operates = vehicle
		character.onboard()

		const job = findUnloadFromVehicleJob(game, character)
		expect(job?.job).toBe('unloadFromVehicle')

		const bay = character.tile.content as StorageAlveolus
		const bayWoodBefore = bay.storage.available('wood')
		const vehicleWoodBefore = vehicle.storage.available('wood')

		const wf = new VehicleFunctions()
		Object.assign(wf, { [subject]: character })
		const step = wf.unloadFromVehicleStep({
			type: 'work',
			job: 'unloadFromVehicle',
			target: vehicle,
			vehicleUid: vehicle.uid,
			goodType: job!.goodType,
			quantity: job!.quantity,
			path: [],
			urgency: job!.urgency,
			fatigue: job!.fatigue,
		}) as DurationStep
		expect(step).toBeInstanceOf(DurationStep)
		step.finish()

		expect(vehicle.storage.available('wood')).toBeLessThan(vehicleWoodBefore)
		expect(bay.storage.available('wood')).toBeGreaterThan(bayWoodBefore)
		assertVehicleServiceOperator(vehicle, character)
		assertDockedSemantics(vehicle)
	})

	it('road-fret freight bay never advertises on-foot gather jobs (wheelbarrow-only)', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [0, 2] as const, terrain: 'grass' as const },
			],
			hives: [
				{
					name: 'NoGatherJobHive',
					alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }],
				},
			],
			looseGoods: [{ goodType: 'wood' as const, position: { q: 0, r: 2 } }],
			freightLines: [
				gatherFreightLine({
					id: 'NoGatherJobHive:gather',
					name: 'Gather wood',
					hiveName: 'NoGatherJobHive',
					coord: [0, 0],
					filters: ['wood'],
					radius: 4,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9509, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const bay = game.hex.getTile({ q: 0, r: 0 })?.content as StorageAlveolus
		expect(bay.hasLooseGoodsToGather).toBe(true)
		expect(bay.nextJob()).toBeUndefined()
	})

	it('projectedLineStopForVehicleHop advances past gather zone when vehicle storage cannot take more selectable goods', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				gatherFreightLine({
					id: 'arb:zone-full',
					name: 'Zone full',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood', 'berries'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9508, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('arb-zf', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('ZoneFull', { q: 0, r: 0 })
		vehicle.beginService(line, line.stops[0]!, character)
		character.operates = vehicle
		character.onboard()
		vehicle.storage.addGood('wood', 1)
		vehicle.storage.addGood('berries', 1)

		const proj = projectedLineStopForVehicleHop(game, character, vehicle)
		expect(proj?.stop.id).toBe(line.stops[1]!.id)
	})
})
