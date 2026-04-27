import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import {
	assertDockedSemantics,
	assertVehicleOperationConsistency,
	traceVehicleStockWithoutService,
} from 'ssh/freight/vehicle-invariants'
import {
	maybeAdvanceVehicleFromCompletedAnchorStop,
	pickInitialVehicleServiceCandidate,
	projectedLineStopForVehicleHop,
} from 'ssh/freight/vehicle-run'
import {
	findProvideFromVehicleJob,
	findUnloadFromVehicleJob,
	findVehicleBeginServiceJob,
	findVehicleHopJob,
	findVehicleOffloadJob,
	findZoneBrowseJob,
} from 'ssh/freight/vehicle-work'
import type { GamePatches } from 'ssh/game/game'
import { Game } from 'ssh/game/game'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { InventoryFunctions } from 'ssh/npcs/context/inventory'
import { VehicleFunctions } from 'ssh/npcs/context/vehicle'
import { subject } from 'ssh/npcs/scripts'
import { DurationStep } from 'ssh/npcs/steps'
import { isVehicleLineService } from 'ssh/population/vehicle/vehicle'
import type { VehicleHopJob } from 'ssh/types/base'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { traces } from '../../src/lib/dev/debug.ts'
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
				{ coord: [1, 0] as const, terrain: 'grass' as const },
				{ coord: [8, 0] as const, terrain: 'grass' as const },
			],
			hives: [
				{
					name: 'H',
					alveoli: [
						{ coord: [0, 0] as const, alveolus: 'freight_bay', goods: {} },
						{ coord: [1, 0] as const, alveolus: 'sawmill', goods: {} },
					],
				},
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
			// Both gather zones need a loose pickable good to qualify for begin-service.
			looseGoods: [
				{ goodType: 'wood' as const, position: { q: 0, r: 0 } },
				{ goodType: 'wood' as const, position: { q: 8, r: 0 } },
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
	})

	it('findVehicleBeginServiceJob is undefined when a gather line has no loose good to pick up', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				gatherFreightLine({
					id: 'arb:empty-gather',
					name: 'Empty gather',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9520, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('arb-empty', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('Empty', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()

		expect(pickInitialVehicleServiceCandidate(game, character, vehicle)).toBeUndefined()
		expect(findVehicleBeginServiceJob(game, character)).toBeUndefined()
	})

	it('compatible loaded cargo enters a served gather line before same-tile construction provide', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
				{ coord: [0, 1] as const, terrain: 'grass' as const },
				{ coord: [-1, 1] as const, terrain: 'grass' as const },
			],
			hives: [
				{
					name: 'H',
					alveoli: [
						{ coord: [0, 0] as const, alveolus: 'freight_bay', goods: {} },
						{ coord: [1, 0] as const, alveolus: 'sawmill', goods: {} },
					],
				},
			],
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
			// Loose good in-zone so the gather line qualifies for begin-service.
			looseGoods: [{ goodType: 'wood' as const, position: { q: 1, r: 0 } }],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9502, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const siteTile = game.hex.getTile({ q: 0, r: 1 })!
		siteTile.content = new BuildDwelling(siteTile, 'basic_dwelling')

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('pv', 'wheelbarrow', { q: 0, r: 0 }, [line])
		vehicle.storage.addGood('wood', 1)

		const character = game.population.createCharacter('Prov', { q: 0, r: 0 })
		bindOperatedWheelbarrowLine(game, character, vehicle)
		character.onboard()

		expect(findProvideFromVehicleJob(game, character)).toBeUndefined()
		expect(pickInitialVehicleServiceCandidate(game, character, vehicle)?.stop.id).toBe(
			line.stops[1]!.id
		)
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
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
			hives: [
				{
					name: 'H',
					alveoli: [
						{ coord: [0, 0] as const, alveolus: 'freight_bay', goods: {} },
						{ coord: [1, 0] as const, alveolus: 'sawmill', goods: {} },
					],
				},
			],
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
			// Both lines need a loose good of their allowed type to qualify; affinity tie-break is the axis under test.
			looseGoods: [
				{ goodType: 'berries' as const, position: { q: 0, r: 0 } },
				{ goodType: 'wood' as const, position: { q: 0, r: 0 } },
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

	it('findVehicleBeginServiceJob rejects a non-empty idle wheelbarrow', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				gatherFreightLine({
					id: 'arb:loaded-idle',
					name: 'Loaded idle',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9510, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('arb-loaded-idle', 'wheelbarrow', { q: 0, r: 0 }, [
			line,
		])
		vehicle.storage.addGood('wood', 1)
		const character = game.population.createCharacter('LoadedIdle', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()

		expect(findVehicleBeginServiceJob(game, character)).toBeUndefined()
	})

	it('tile.isBurdened counts idle vehicles but ignores docked vehicles', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'concrete' as const },
				{ coord: [1, 0] as const, terrain: 'concrete' as const },
			],
			hives: [
				{
					name: 'BurdenBay',
					alveoli: [{ coord: [1, 0], alveolus: 'freight_bay', goods: {} }],
				},
			],
			freightLines: [
				gatherFreightLine({
					id: 'arb:docked',
					name: 'Docked line',
					hiveName: 'BurdenBay',
					coord: [1, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9511, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const idleTile = game.hex.getTile({ q: 0, r: 0 })!
		const dockTile = game.hex.getTile({ q: 1, r: 0 })!
		const line = game.freightLines[0]!
		const unloadStop = line.stops[1]!

		game.vehicles.createVehicle('arb-idle-burden', 'wheelbarrow', { q: 0, r: 0 })
		expect(idleTile.isBurdened).toBe(true)

		const dockedVehicle = game.vehicles.createVehicle(
			'arb-docked-burden',
			'wheelbarrow',
			{ q: 1, r: 0 },
			[line]
		)
		const character = game.population.createCharacter('Docked', { q: 1, r: 0 })
		dockedVehicle.beginService(line, unloadStop, character)
		dockedVehicle.dock()
		expect(dockTile.isBurdened).toBe(false)
	})

	it('canDropLooseHere follows tile burdening but allows the operator own vehicle tile', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9513, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const tile = game.hex.getTile({ q: 0, r: 0 })!
		const character = game.population.createCharacter('Dropper', { q: 0, r: 0 })
		const inv = new InventoryFunctions()
		Object.assign(inv, { [subject]: character })

		expect(inv.canDropLooseHere()).toBe(true)

		const ownVehicle = game.vehicles.createVehicle('arb-own-drop', 'wheelbarrow', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, ownVehicle)
		character.onboard()
		expect(tile.isBurdened).toBe(true)
		expect(inv.canDropLooseHere()).toBe(true)

		game.hex.looseGoods.add(tile, 'wood')
		expect(inv.canDropLooseHere()).toBe(false)
	})

	it('completed last docked anchor ends line service and exposes park maintenance next tick', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'concrete' as const }],
			hives: [
				{
					name: 'ParkAfterDock',
					alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }],
				},
			],
			freightLines: [
				gatherFreightLine({
					id: 'arb:park-after-dock',
					name: 'Park after dock',
					hiveName: 'ParkAfterDock',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9512, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const unloadStop = line.stops[1]!
		const vehicle = game.vehicles.createVehicle(
			'arb-park-after-dock',
			'wheelbarrow',
			{ q: 0, r: 0 },
			[line]
		)
		const actor = game.population.createCharacter('DockActor', { q: 0, r: 0 })
		vehicle.beginService(line, unloadStop, actor)
		vehicle.dock()

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
			maybeAdvanceVehicleFromCompletedAnchorStop(game, vehicle, actor)
			expect(vehicle.service).toBeUndefined()
			expect(log).toHaveBeenCalledWith('vehicleJob.dock.complete', {
				vehicleUid: vehicle.uid,
				lineId: line.id,
				stopId: unloadStop.id,
				outcome: 'park-next',
				hasStock: false,
			})
		} finally {
			traces.vehicle = prev
		}

		void actor.scriptsContext
		const parkJob = findVehicleOffloadJob(game, actor)
		expect(parkJob?.maintenanceKind).toBe('park')
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
		assertVehicleOperationConsistency(vehicle, character)
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

	it('vehicleHopPrepare ends an empty gather service instead of advancing to the bay', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				gatherFreightLine({
					id: 'arb:prepare-replan',
					name: 'Prepare replan',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9514, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('arb-replan', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const actor = game.population.createCharacter('Replan', { q: 0, r: 0 })
		vehicle.beginService(line, line.stops[0]!, actor)
		actor.operates = vehicle
		actor.onboard()

		const vf = new VehicleFunctions()
		Object.assign(vf, { [subject]: actor })
		const plan: VehicleHopJob & {
			type: 'work'
			target: typeof vehicle
			vehicleHopRunEnded?: boolean
			vehicleHopReplanRequired?: boolean
		} = {
			type: 'work' as const,
			job: 'vehicleHop' as const,
			target: vehicle,
			urgency: 1,
			fatigue: 1,
			vehicleUid: vehicle.uid,
			lineId: line.id,
			stopId: line.stops[0]!.id,
			path: [],
			dockEnter: false,
		}

		vf.vehicleHopPrepare(plan)

		expect(plan.vehicleHopRunEnded).toBe(true)
		expect(plan.vehicleHopReplanRequired).toBe(false)
		expect(vehicle.service).toBeUndefined()
	})

	it('anchor vehicleHopDockStep keeps the operator linked until the dock step finishes', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'concrete' as const }],
			hives: [
				{
					name: 'DockStepHive',
					alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }],
				},
			],
			freightLines: [
				gatherFreightLine({
					id: 'arb:dock-step',
					name: 'Dock step',
					hiveName: 'DockStepHive',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9515, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const unloadStop = line.stops[1]!
		const vehicle = game.vehicles.createVehicle('arb-dock-step', 'wheelbarrow', { q: 0, r: 0 }, [
			line,
		])
		const actor = game.population.createCharacter('DockStepActor', { q: 0, r: 0 })
		vehicle.beginService(line, unloadStop, actor)
		actor.operates = vehicle
		actor.onboard()

		const vf = new VehicleFunctions()
		Object.assign(vf, { [subject]: actor })
		const step = vf.vehicleHopDockStep({
			type: 'work',
			job: 'vehicleHop',
			target: vehicle,
			urgency: 1,
			fatigue: 1,
			vehicleUid: vehicle.uid,
			lineId: line.id,
			stopId: unloadStop.id,
			path: [],
			dockEnter: true,
		}) as DurationStep

		expect(step).toBeInstanceOf(DurationStep)
		expect(actor.operates?.uid).toBe(vehicle.uid)
		expect(actor.driving).toBe(true)
		expect(vehicle.operator?.uid).toBe(actor.uid)
		expect(isVehicleLineService(vehicle.service) && vehicle.service.docked).toBe(true)

		step.finish()

		expect(actor.operates).toBeUndefined()
		expect(actor.driving).toBe(false)
		expect(vehicle.operator).toBeUndefined()
		expect(isVehicleLineService(vehicle.service) && vehicle.service.docked).toBe(true)
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

	it('prefers continuing a loaded line over same-tile ordinary transform work', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'concrete' as const },
				{ coord: [1, 0] as const, terrain: 'concrete' as const },
			],
			hives: [
				{
					name: 'LineWorkHive',
					alveoli: [
						{ coord: [0, 0] as const, alveolus: 'freight_bay' as const, goods: {} },
						{ coord: [1, 0] as const, alveolus: 'sawmill' as const, goods: { wood: 1 } },
					],
				},
			],
			freightLines: [
				gatherFreightLine({
					id: 'arb:line-work-priority',
					name: 'Line work priority',
					hiveName: 'LineWorkHive',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9517, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('arb-line-work', 'wheelbarrow', { q: 1, r: 0 }, [
			line,
		])
		vehicle.storage.addGood('wood', 1)
		vehicle.beginLineService(line, line.stops[0]!)
		const character = game.population.createCharacter('LineWork', { q: 1, r: 0 })

		const match = character.resolveBestJobMatch()

		if (!match || match.job.job !== 'vehicleHop') throw new Error('expected vehicleHop')
		expect(match.job.job).toBe('vehicleHop')
		expect(match.job.vehicleUid).toBe(vehicle.uid)
	})

	it('continues an unattended loaded gather-zone service to the bay', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'concrete' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
			hives: [
				{
					name: 'UnattendedLoadedHive',
					alveoli: [
						{ coord: [0, 0] as const, alveolus: 'freight_bay' as const, goods: {} },
						{ coord: [1, 0] as const, alveolus: 'sawmill' as const, goods: {} },
					],
				},
			],
			freightLines: [
				gatherFreightLine({
					id: 'arb:unattended-loaded-zone',
					name: 'Unattended loaded zone',
					hiveName: 'UnattendedLoadedHive',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9519, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle(
			'arb-unattended-loaded',
			'wheelbarrow',
			{ q: 1, r: 0 },
			[line]
		)
		vehicle.beginLineService(line, line.stops[0]!)
		vehicle.storage.addGood('wood', 1)
		const character = game.population.createCharacter('UnattendedLoaded', { q: 1, r: 0 })

		const hop = findVehicleHopJob(game, character)

		expect(hop?.job).toBe('vehicleHop')
		expect(hop?.vehicleUid).toBe(vehicle.uid)
		expect(hop?.stopId).toBe(line.stops[1]!.id)
		expect(hop?.approachPath).toHaveLength(0)
		expect(hop?.needsBeginService).toBeUndefined()
	})

	it('scores zoneBrowse by approach distance, not target-tile travel', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [0, 1] as const, terrain: 'grass' as const },
				{ coord: [0, 2] as const, terrain: 'grass' as const },
			],
			hives: [
				{
					name: 'ZoneBrowseScoreHive',
					alveoli: [
						{ coord: [0, 0] as const, alveolus: 'freight_bay' as const, goods: {} },
						{ coord: [0, 1] as const, alveolus: 'sawmill' as const, goods: {} },
					],
				},
			],
			looseGoods: [{ goodType: 'wood' as const, position: { q: 0, r: 2 } }],
			freightLines: [
				gatherFreightLine({
					id: 'arb:zone-browse-score',
					name: 'Zone browse score',
					hiveName: 'ZoneBrowseScoreHive',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9518, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle(
			'arb-zone-browse-score',
			'wheelbarrow',
			{ q: 0, r: 0 },
			[line]
		)
		const character = game.population.createCharacter('ZoneBrowseScore', { q: 0, r: 0 })
		vehicle.beginService(line, line.stops[0]!, character)
		character.operates = vehicle
		character.onboard()

		const job = findZoneBrowseJob(game, character)
		expect(job?.job).toBe('zoneBrowse')
		if (!job) throw new Error('expected zoneBrowse')
		expect(job.path.length).toBeGreaterThan(job.approachPath?.length ?? 0)

		character.resolveBestJobMatch()
		const row = character.workPlannerSnapshot?.ranked.find(
			(entry) => entry.jobKind === 'zoneBrowse'
		)

		expect(row?.pathLength).toBe(job.approachPath?.length ?? 0)
	})
})
