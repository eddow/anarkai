// @ts-nocheck
import { normalizeFreightLineDefinition } from 'ssh/freight/freight-line'
import { migrateV1FiltersToGoodsSelection } from 'ssh/freight/goods-selection-policy'
import { findVehicleHopJob, findVehicleOffloadJob } from 'ssh/freight/vehicle-work'
import { chopSaw } from 'ssh/game/exampleGames'
import type { GamePatches } from 'ssh/game/game'
import { Game } from 'ssh/game/game'
import { VehicleFunctions } from 'ssh/npcs/context/vehicle'
import { subject } from 'ssh/npcs/scripts'
import { isVehicleLineService } from 'ssh/population/vehicle/vehicle'
import type { WorkPlan } from 'ssh/types/base'
import { axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import { afterEach, describe, expect, it } from 'vitest'
import { distributeFreightLine, gatherFreightLine } from '../freight-fixtures'
import { debugObjectId } from 'ssh/dev/debug-object-id'

describe('vehicleHopPrepare / vehicleHopDockStep service lifecycle', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('marks vehicleHopRunEnded and skips dock when last zone stop completes and ends the run', async () => {
		const zoneOnlyLine = normalizeFreightLineDefinition({
			name: 'Zone only',
			stops: [
				{
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
		const vehicle = game.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 }, [line])
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
			vehicle,
			line: line,
			stopIndex: 1,
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
			name: 'Zone only',
			stops: [
				{
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
		const vehicle = game.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 }, [line])
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
			vehicle,
			line: line,
			stopIndex: 1,
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
		const vehicle = game.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 }, [line])
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
			vehicle,
			line: line,
			stopIndex: 0,
			path: [],
			dockEnter: false,
		}

		const step = vf.vehicleHopDockStep(jobPlan)
		expect(jobPlan.vehicleHopAnchorDockDisembarked).toBe(true)
		expect(character.operates).toBe(vehicle)
		expect(vehicle.service).toBeDefined()
		// Disembark is deferred to the DurationStep's fulfilled callback so the operator
		// stays attached for the dock animation; flush it to assert the post-dock state.
		step?.tick(999)
		expect(character.operates).toBeUndefined()
		expect(vehicle.service).toBeDefined()
	})

	it('vehicle dock refuses to clear world position before reaching the anchor tile', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
				{ coord: [2, 0] as const, terrain: 'grass' as const },
			],
			freightLines: [
				distributeFreightLine({
					name: 'Distribute',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 96121, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const loadStop = line.stops[0]!
		const vehicle = game.vehicles.createVehicle('wheelbarrow', { q: 2, r: 0 }, [line])
		const character = game.population.createCharacter('AnchorDockPosition', { q: 2, r: 0 })
		vehicle.beginLineService(line, loadStop, character)

		expect(() => vehicle.dock()).toThrow(/dock requires vehicle to be on the anchor tile/)
		expect(vehicle.position).toMatchObject({ q: 2, r: 0 })
		expect(isVehicleLineService(vehicle.service) && vehicle.service.docked).toBe(false)
	})

	it('vehicleHopDockStep docks the live ChopSaw wheelbarrow from the adjacent bay border tile', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.name === 'ChopSaw (0, 0) gather'
		)
		// ChopSaw gather is cyclic [anchor, zone]; bay dock is the anchor at stops[0].
		const anchorStop = line?.stops.find((stop) => 'anchor' in stop)
		const vehicle = [...game.vehicles].find((v: any) => v.name === 'ChopSaw:wheelbarrow1')!
		if (!line || !anchorStop || !vehicle) throw new Error('expected ChopSaw gather fixture')

		vehicle.position = { q: -1, r: 0 }
		const character = game.population.createCharacter('ChopSawDockRegression', { q: -1, r: 0 })
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
			vehicle,
			line,
			stopIndex: line.stops.indexOf(anchorStop),
			path: [],
			dockEnter: true,
		}

		const dockStep = vf.vehicleHopDockStep(jobPlan)
		dockStep?.finish()
		expect(vehicle.isDocked).toBe(true)
		expect(vehicle.position).toBeUndefined()
		expect(jobPlan.vehicleHopAnchorDockDisembarked).toBe(true)
	})

	it('vehicleHop reaches the ChopSaw bay before docking from a returned zone service', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.name === 'ChopSaw (0, 0) gather'
		)
		// ChopSaw gather unload/dock anchor is stops[0].
		const unloadStop = line?.stops[0]
		const vehicle = [...game.vehicles].find((v: any) => v.name === 'ChopSaw:wheelbarrow1')!
		if (!line || !unloadStop || !('anchor' in unloadStop) || !vehicle)
			throw new Error('expected ChopSaw gather fixture')

		vehicle.position = { q: -2, r: 1 }
		vehicle.beginLineService(line, unloadStop)
		const character = game.population.createCharacter('ChopSawDockReturn', { q: -2, r: 1 })
		character.operates = vehicle
		character.onboard()

		const hop = findVehicleHopJob(game, character)
		expect(hop?.job).toBe('vehicleHop')
		expect(hop?.stopIndex).toBe(line.stops.indexOf(unloadStop))
		expect(hop?.dockEnter).toBe(true)
		expect(hop?.path.length).toBeGreaterThan(0)

		for (const step of hop!.path) {
			const targetTile = game.hex.getTile(step)
			if (targetTile && axial.key(toAxialCoord(targetTile.position)!) === axial.key(step)) {
				character.position = {
					q: (toAxialCoord(character.tile.position)!.q + step.q) / 2,
					r: (toAxialCoord(character.tile.position)!.r + step.r) / 2,
				}
				character.stepOn(targetTile)
			} else {
				character.position = step
			}
		}
		if (hop!.dockEnter) character.position = character.tile.position

		const vf = new VehicleFunctions()
		Object.assign(vf, { [subject]: character })
		const jobPlan: WorkPlan = {
			type: 'work',
			job: 'vehicleHop',
			target: character.tile,
			urgency: hop!.urgency,
			fatigue: hop!.fatigue,
			vehicle,
			line: line,
			stopIndex: line.stops.indexOf(unloadStop),
			path: hop!.path,
			dockEnter: true,
		}

		const dockStep = vf.vehicleHopDockStep(jobPlan)
		dockStep?.finish()
		expect(vehicle.isDocked).toBe(true)
	})

	it('vehicleHopDockStep replans instead of asserting when the ChopSaw bay dock tail is stale', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.name === 'ChopSaw (0, 0) gather'
		)
		const unloadStop = line?.stops[0]
		const vehicle = [...game.vehicles].find((v: any) => v.name === 'ChopSaw:wheelbarrow1')!
		if (!line || !unloadStop || !('anchor' in unloadStop) || !vehicle)
			throw new Error('expected ChopSaw gather fixture')

		vehicle.position = { q: -2, r: 1 }
		vehicle.beginLineService(line, unloadStop)
		const character = game.population.createCharacter('ChopSawStaleDockTail', { q: -2, r: 1 })
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
			vehicle,
			line: line,
			stopIndex: line.stops.indexOf(unloadStop),
			path: [],
			dockEnter: true,
		}

		const recoveryStep = vf.vehicleHopDockStep(jobPlan)
		// Either a recovery MoveToStep toward the bay, or an explicit replan signal when no path exists.
		expect(recoveryStep !== undefined || jobPlan.vehicleHopReplanRequired === true).toBe(true)
		expect(vehicle.isDocked).toBe(false)
		if (recoveryStep) {
			recoveryStep.tick(Number.POSITIVE_INFINITY)
			expect(vehicle.position).not.toMatchObject({ q: -2, r: 1 })
		}
	})

	it('vehicleHopPrepare repairs a missing path to a live ChopSaw bay anchor', async () => {
		game = new Game({ terrainSeed: 550, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.name === 'ChopSaw (0, 0) gather'
		)
		const unloadStop = line?.stops[0]
		const vehicle = [...game.vehicles].find((v: any) => v.name === 'ChopSaw:wheelbarrow1')!
		if (!line || !unloadStop || !('anchor' in unloadStop) || !vehicle)
			throw new Error('expected ChopSaw gather fixture')

		vehicle.position = { q: -2, r: 1 }
		vehicle.beginLineService(line, unloadStop)
		const character = game.population.createCharacter('ChopSawRepairDockPath', { q: -2, r: 1 })
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
			vehicle,
			line: line,
			stop: unloadStop,
			stopIndex: line.stops.indexOf(unloadStop),
			path: [],
			dockEnter: true,
		}

		vf.vehicleHopPrepare(jobPlan)
		expect(jobPlan.vehicleHopReplanRequired).toBe(false)
		expect(jobPlan.path?.length).toBeGreaterThan(0)
		expect(vehicle.isDocked).toBe(false)
		expect(vehicle.position).toMatchObject({ q: -2, r: 1 })
	})

	it('vehicleHopDockStep checks final empty anchors after dock advertisements settle', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'concrete' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
			hives: [
				{
					name: 'DockAfterAds',
					alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }],
				},
			],
			freightLines: [
				gatherFreightLine({
					name: 'Dock after ads',
					hiveName: 'DockAfterAds',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9615, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		// Pick the explicit non-cyclic gather line, not the bootstrap implicit cyclic one.
		const line = game.freightLines.find((l) => l.name === 'Dock after ads')!
		if (!line) throw new Error('expected explicit Dock after ads line')
		expect(line.cyclic).toBeFalsy()
		const unloadStop = line.stops[1]!
		const vehicle = game.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('EmptyDock', { q: 0, r: 0 })
		vehicle.beginLineService(line, unloadStop, character)
		character.operates = vehicle
		character.onboard()

		const vf = new VehicleFunctions()
		Object.assign(vf, { [subject]: character })

		const step = vf.vehicleHopDockStep({
			type: 'work',
			job: 'vehicleHop',
			target: character.tile,
			urgency: 1,
			fatigue: 1,
			vehicle,
			line: line,
			stopIndex: 1,
			path: [],
			dockEnter: true,
		})

		step?.tick(999)
		expect(vehicle.service).toBeDefined()
		await new Promise((resolve) => setTimeout(resolve, 5))

		expect(vehicle.service).toBeUndefined()
		expect(vehicle.position && axial.key(toAxialCoord(vehicle.position)!)).toBe(
			axial.key({ q: 0, r: 0 })
		)
		const park = findVehicleOffloadJob(game, character)
		expect(park?.maintenanceKind).toBe('park')
	})

	it('vehicleHopDockStep keeps stocked anchors docked while dock advertising creates movement', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'concrete' as const }],
			hives: [
				{
					name: 'DockStockAfterAds',
					alveoli: [
						{ coord: [0, 0], alveolus: 'freight_bay', goods: {} },
						{
							coord: [1, 0],
							alveolus: 'storage',
							goods: {},
							configuration: {
								ref: { scope: 'individual' },
								individual: {
									working: true,
									generalSlots: 0,
									goods: { wood: { minSlots: 1, maxSlots: 1 } },
								},
							},
						},
					],
				},
			],
			freightLines: [
				gatherFreightLine({
					name: 'Dock stock after ads',
					hiveName: 'DockStockAfterAds',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9616, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const unloadStop = line.stops[1]!
		const vehicle = game.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 }, [line])
		vehicle.storage.addGood('wood', 1)
		const character = game.population.createCharacter('StockDock', { q: 0, r: 0 })
		vehicle.beginLineService(line, unloadStop, character)
		character.operates = vehicle
		character.onboard()

		const vf = new VehicleFunctions()
		Object.assign(vf, { [subject]: character })

		const step = vf.vehicleHopDockStep({
			type: 'work',
			job: 'vehicleHop',
			target: character.tile,
			urgency: 1,
			fatigue: 1,
			vehicle,
			line: line,
			stopIndex: 1,
			path: [],
			dockEnter: true,
		})

		step?.tick(999)
		await new Promise((resolve) => setTimeout(resolve, 5))

		expect(isVehicleLineService(vehicle.service)).toBe(true)
		expect(isVehicleLineService(vehicle.service) && vehicle.service.docked).toBe(true)
	})

	it('vehicleHopDockStep clears vehicleHopAnchorDockDisembarked on zone stops', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				gatherFreightLine({
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
		const vehicle = game.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 }, [line])
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
			vehicle,
			line: line,
			// Live service is on the zone stop (index 0 for gatherFreightLine).
			stopIndex: 0,
			path: [],
			dockEnter: false,
			vehicleHopAnchorDockDisembarked: true,
		}

		const step = vf.vehicleHopDockStep(jobPlan)
		step?.finish()
		expect(jobPlan.vehicleHopAnchorDockDisembarked).toBe(false)
		expect(character.operates).toBe(vehicle)
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
		const _zoneStop = line.stops[0]!
		const anchorStop = line.stops[1]!
		const vehicle = game.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 }, [line])
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
			vehicle,
			line: line,
			// Stale plan still targets the zone stop while live service is on the anchor.
			stopIndex: 0,
			path: [],
			dockEnter: false,
		}

		const step = vf.vehicleHopDockStep(jobPlan)
		expect(step).toBeUndefined()
		expect(jobPlan.vehicleHopAnchorDockDisembarked).toBeFalsy()
		expect(character.operates).toBe(vehicle)
		expect(vehicle.service).toBeDefined()
	})
})
