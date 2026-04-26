import { normalizeFreightLineDefinition } from 'ssh/freight/freight-line'
import { migrateV1FiltersToGoodsSelection } from 'ssh/freight/goods-selection-policy'
import type { GamePatches } from 'ssh/game/game'
import { Game } from 'ssh/game/game'
import { VehicleFunctions } from 'ssh/npcs/context/vehicle'
import { subject } from 'ssh/npcs/scripts'
import type { WorkPlan } from 'ssh/types/base'
import { axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import { afterEach, describe, expect, it } from 'vitest'
import { distributeFreightLine, gatherFreightLine } from '../freight-fixtures'

describe('vehicleHopPrepare / vehicleHopDockStep service lifecycle', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('marks vehicleHopRunEnded and skips dock when last zone stop completes and ends the run', async () => {
		const zoneOnlyLine = normalizeFreightLineDefinition({
			id: 'hop:zone-only',
			name: 'Zone only',
			stops: [
				{
					id: 'only-zone',
					loadSelection: migrateV1FiltersToGoodsSelection(['wood']),
					zone: { kind: 'radius', center: [0, 0] as const, radius: 2 },
				},
			],
		})
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [zoneOnlyLine],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9610, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const zoneStop = line.stops[0]!
		const vehicle = game.vehicles.createVehicle('hop-z', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('HopPrep', { q: 0, r: 0 })
		vehicle.beginService(line, zoneStop, character)
		character.operates = vehicle
		character.onboard()

		const vf = new VehicleFunctions()
		Object.assign(vf, { [subject]: character })

		const jobPlan: WorkPlan = {
			type: 'work',
			job: 'vehicleHop',
			target: character.tile,
			urgency: 1,
			fatigue: 1,
			vehicleUid: vehicle.uid,
			lineId: line.id,
			stopId: zoneStop.id,
			path: [],
			dockEnter: false,
		}

		vf.vehicleHopPrepare(jobPlan)
		expect(vehicle.service).toBeUndefined()
		expect(jobPlan.vehicleHopRunEnded).toBe(true)
		expect(character.driving).toBe(false)
		expect(character.operates).toBeUndefined()
		expect(axial.key(toAxialCoord(character.position)!)).toBe(axial.key({ q: 0, r: 0 }))

		expect(() =>
			vf.vehicleHopDockStep({
				...jobPlan,
				vehicleHopRunEnded: true,
			})
		).not.toThrow()
	})

	it('vehicleHopPrepare clears stale vehicleHopAnchorDockDisembarked', async () => {
		const zoneOnlyLine = normalizeFreightLineDefinition({
			id: 'hop:anchor-flag-reset',
			name: 'Zone only',
			stops: [
				{
					id: 'only-zone',
					loadSelection: migrateV1FiltersToGoodsSelection(['wood']),
					zone: { kind: 'radius', center: [0, 0] as const, radius: 2 },
				},
			],
		})
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [zoneOnlyLine],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9611, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const zoneStop = line.stops[0]!
		const vehicle = game.vehicles.createVehicle('hop-flag', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('HopFlag', { q: 0, r: 0 })
		vehicle.beginService(line, zoneStop, character)
		character.operates = vehicle
		character.onboard()

		const vf = new VehicleFunctions()
		Object.assign(vf, { [subject]: character })

		const jobPlan: WorkPlan = {
			type: 'work',
			job: 'vehicleHop',
			target: character.tile,
			urgency: 1,
			fatigue: 1,
			vehicleUid: vehicle.uid,
			lineId: line.id,
			stopId: zoneStop.id,
			path: [],
			dockEnter: false,
			vehicleHopAnchorDockDisembarked: true,
		}

		vf.vehicleHopPrepare(jobPlan)
		expect(jobPlan.vehicleHopAnchorDockDisembarked).toBe(false)
	})

	it('vehicleHopDockStep sets vehicleHopAnchorDockDisembarked on bay anchor docks', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				distributeFreightLine({
					id: 'hop:anchor-dock-flag',
					name: 'Distribute',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9612, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const loadStop = line.stops[0]!
		const vehicle = game.vehicles.createVehicle('hop-adock', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('AnchorDock', { q: 0, r: 0 })
		vehicle.beginLineService(line, loadStop, character)
		character.operates = vehicle
		character.onboard()

		const vf = new VehicleFunctions()
		Object.assign(vf, { [subject]: character })

		const jobPlan: WorkPlan = {
			type: 'work',
			job: 'vehicleHop',
			target: character.tile,
			urgency: 1,
			fatigue: 1,
			vehicleUid: vehicle.uid,
			lineId: line.id,
			stopId: loadStop.id,
			path: [],
			dockEnter: false,
		}

		const step = vf.vehicleHopDockStep(jobPlan)
		expect(jobPlan.vehicleHopAnchorDockDisembarked).toBe(true)
		expect(character.operates?.uid).toBe(vehicle.uid)
		expect(vehicle.service).toBeDefined()
		// Disembark is deferred to the DurationStep's finished callback so the operator
		// stays attached for the dock animation; flush it to assert the post-dock state.
		step?.finish?.()
		expect(character.operates).toBeUndefined()
		expect(vehicle.service).toBeDefined()
	})

	it('vehicleHopDockStep clears vehicleHopAnchorDockDisembarked on zone stops', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				gatherFreightLine({
					id: 'hop:zone-dock-flag',
					name: 'Gather',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9613, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const zoneStop = line.stops[0]!
		const vehicle = game.vehicles.createVehicle('hop-zdock', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('ZoneDock', { q: 0, r: 0 })
		vehicle.beginLineService(line, zoneStop, character)
		character.operates = vehicle
		character.onboard()

		const vf = new VehicleFunctions()
		Object.assign(vf, { [subject]: character })

		const jobPlan: WorkPlan = {
			type: 'work',
			job: 'vehicleHop',
			target: character.tile,
			urgency: 1,
			fatigue: 1,
			vehicleUid: vehicle.uid,
			lineId: line.id,
			stopId: zoneStop.id,
			path: [],
			dockEnter: false,
			vehicleHopAnchorDockDisembarked: true,
		}

		vf.vehicleHopDockStep(jobPlan)
		expect(jobPlan.vehicleHopAnchorDockDisembarked).toBe(false)
		expect(character.operates?.uid).toBe(vehicle.uid)
	})

	it('vehicleHopDockStep refuses to dock when live service drifted from the planned stop', async () => {
		// Reproduces the trace where a vehicleHop selected for a zone stop ends up running the dock
		// against the next anchor stop because `vehicleHopPrepare` advanced the live service. Even if
		// the .npcs script body is stale and skips the replan return, the engine-level guard keeps the
		// dock + offboard from running and prevents the selected/onboard/dock/offboard infinite loop.
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				gatherFreightLine({
					id: 'hop:drift-guard',
					name: 'Gather',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9614, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const zoneStop = line.stops[0]!
		const anchorStop = line.stops[1]!
		const vehicle = game.vehicles.createVehicle('hop-drift', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('Drift', { q: 0, r: 0 })
		// Live service is on the anchor stop, but the (stale) plan still targets the zone stop.
		vehicle.beginLineService(line, anchorStop, character)
		character.operates = vehicle
		character.onboard()

		const vf = new VehicleFunctions()
		Object.assign(vf, { [subject]: character })

		const jobPlan: WorkPlan = {
			type: 'work',
			job: 'vehicleHop',
			target: character.tile,
			urgency: 1,
			fatigue: 1,
			vehicleUid: vehicle.uid,
			lineId: line.id,
			stopId: zoneStop.id,
			path: [],
			dockEnter: false,
		}

		const step = vf.vehicleHopDockStep(jobPlan)
		expect(step).toBeUndefined()
		expect(jobPlan.vehicleHopAnchorDockDisembarked).toBeFalsy()
		expect(character.operates?.uid).toBe(vehicle.uid)
		expect(vehicle.service).toBeDefined()
	})
})
