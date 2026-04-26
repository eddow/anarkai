import { releaseVehicleFreightWorkOnPlanInterrupt } from 'ssh/freight/vehicle-run'
import { allocateVehicleServiceForJob, findVehicleOffloadJob } from 'ssh/freight/vehicle-work'
import type { GamePatches } from 'ssh/game/game'
import { Game } from 'ssh/game/game'
import { isVehicleLineService, isVehicleMaintenanceService } from 'ssh/population/vehicle/vehicle'
import type { WorkPlan } from 'ssh/types/base'
import { axialDistance, toAxialCoord } from 'ssh/utils/position'
import { afterEach, describe, expect, it } from 'vitest'
import { gatherFreightLine } from '../freight-fixtures'
import { bindOperatedWheelbarrowOffload } from '../test-engine/vehicle-bind'

function tickUntilAwayFrom(
	character: {
		update(dt: number): void
		position: { q: number; r: number } | { x: number; y: number }
	},
	origin: { q: number; r: number } | { x: number; y: number }
): void {
	for (let i = 0; i < 80; i++) {
		if (axialDistance(character.position, origin) > 0.05) return
		character.update(0.05)
	}
}

describe('Vehicle usage invariant', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('vehicle work-plan begin establishes the character-vehicle-service-operator link', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9601, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('vu-begin', 'wheelbarrow', { q: 0, r: 0 }, [])
		vehicle.storage.addGood('wood', 1)
		const character = game.population.createCharacter('UsageBegin', { q: 0, r: 0 })
		const plan: WorkPlan = {
			type: 'work',
			job: 'vehicleOffload',
			maintenanceKind: 'unloadToTile',
			vehicleUid: vehicle.uid,
			target: vehicle,
			path: [],
			targetCoord: { q: 1, r: 0 },
			urgency: 1,
			fatigue: 0,
		}

		character.scriptsContext.plan.begin(plan)

		expect(character.operates?.uid).toBe(vehicle.uid)
		expect(vehicle.operator?.uid).toBe(character.uid)
		const service = vehicle.service
		expect(isVehicleMaintenanceService(service)).toBe(true)
		if (!isVehicleMaintenanceService(service)) throw new Error('expected maintenance service')
		expect(service.kind).toBe('unloadToTile')
		expect(service.targetCoord).toEqual({ q: 1, r: 0 })
	})

	it('non-vehicle work-plan begin releases vehicle usage but keeps unfinished service resumable', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9602, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('vu-release', 'wheelbarrow', { q: 0, r: 0 }, [])
		vehicle.storage.addGood('wood', 1)
		const character = game.population.createCharacter('UsageRelease', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle, {
			kind: 'unloadToTile',
			targetCoord: { q: 1, r: 0 },
		})
		character.onboard()
		const target = game.hex.getTile({ q: 0, r: 0 })!.content!
		const nonVehiclePlan = {
			type: 'work',
			job: 'harvest',
			target,
			path: [],
			urgency: 1,
			fatigue: 0,
		} as const

		character.scriptsContext.plan.begin(nonVehiclePlan as WorkPlan)

		expect(character.operates).toBeUndefined()
		expect(vehicle.operator).toBeUndefined()
		expect(isVehicleMaintenanceService(vehicle.service)).toBe(true)
		const nextWorker = game.population.createCharacter('UsageResume', { q: 1, r: 0 })
		const resume = findVehicleOffloadJob(game, nextWorker)
		expect(resume?.job).toBe('vehicleOffload')
		expect(resume?.maintenanceKind).toBe('unloadToTile')
		expect(resume?.vehicleUid).toBe(vehicle.uid)
	})

	it('interrupt release clears stale character links even when service operator drifted', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
			freightLines: [
				gatherFreightLine({
					id: 'VU:operator-drift',
					name: 'Operator drift',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 1,
				}),
			],
			looseGoods: [{ goodType: 'wood' as const, position: { q: 0, r: 0 } }],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9603, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const stop = line.stops[0]!
		const vehicle = game.vehicles.createVehicle('vu-drift', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const first = game.population.createCharacter('UsageFirst', { q: 0, r: 0 })
		const second = game.population.createCharacter('UsageSecond', { q: 1, r: 0 })
		vehicle.beginLineService(line, stop, first)
		first.operates = vehicle
		vehicle.releaseOperator(first)
		vehicle.setServiceOperator(second)

		releaseVehicleFreightWorkOnPlanInterrupt(first)

		expect(first.operates).toBeUndefined()
		expect(vehicle.operator?.uid).toBe(second.uid)
		expect(isVehicleLineService(vehicle.service)).toBe(true)
	})

	it('vehicle usage release resyncs foot position and tile after driving the vehicle', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9604, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('vu-foot', 'wheelbarrow', { q: 0, r: 0 }, [])
		const character = game.population.createCharacter('UsageFoot', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()
		character.position = { q: 1, r: 0 }

		releaseVehicleFreightWorkOnPlanInterrupt(character)

		expect(character.operates).toBeUndefined()
		expect(vehicle.operator).toBeUndefined()
		expect(toAxialCoord(character.position)).toMatchObject({ q: 1, r: 0 })
		expect(toAxialCoord(character.tile.position)).toMatchObject({ q: 1, r: 0 })
	})

	it('vehicleOffload cannot take over a vehicle currently serving a line', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
			freightLines: [
				gatherFreightLine({
					id: 'VU:line-lock',
					name: 'Line lock',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 1,
				}),
			],
			looseGoods: [{ goodType: 'wood' as const, position: { q: 1, r: 0 } }],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9605, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('vu-line-lock', 'wheelbarrow', { q: 0, r: 0 }, [
			line,
		])
		const character = game.population.createCharacter('UsageLock', { q: 0, r: 0 })
		vehicle.beginLineService(line, line.stops[0]!, character)

		expect(() =>
			allocateVehicleServiceForJob(game, character, vehicle, {
				job: 'vehicleOffload',
				urgency: 1,
				fatigue: 1,
				vehicleUid: vehicle.uid,
				targetCoord: { q: 1, r: 0 },
				path: [],
				maintenanceKind: 'park',
			})
		).toThrow(/line service already active/)
	})

	it('released last operator can wander away from the vehicle position', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
				{ coord: [2, 0] as const, terrain: 'grass' as const },
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9606, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('vu-wander-away', 'wheelbarrow', { q: 0, r: 0 }, [])
		const character = game.population.createCharacter('UsageWanderAway', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()
		character.position = { q: 1, r: 0 }
		releaseVehicleFreightWorkOnPlanInterrupt(character)
		const vehiclePosition = { ...vehicle.position }

		character.begin(character.scriptsContext.selfCare.wander())
		tickUntilAwayFrom(character, vehiclePosition)

		expect(character.operates).toBeUndefined()
		expect(axialDistance(character.position, vehiclePosition)).toBeGreaterThan(0.05)
	})

	it('released last operator can walk into a non-vehicle work preparation', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
				{ coord: [2, 0] as const, terrain: 'grass' as const },
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9607, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('vu-work-away', 'wheelbarrow', { q: 0, r: 0 }, [])
		const character = game.population.createCharacter('UsageWorkAway', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()
		character.position = { q: 1, r: 0 }
		const vehiclePosition = { ...vehicle.position }
		const targetTile = game.hex.getTile({ q: 2, r: 0 })!
		const target = {
			tile: targetTile,
			preparationTime: 1,
			action: { type: 'harvest', deposit: 'tree', output: { wood: 1 } },
			nextJob: () => false,
			hive: { name: 'UsageHive' },
		}
		const plan = {
			type: 'work',
			job: 'harvest',
			target,
			path: [{ q: 2, r: 0 }],
			urgency: 1,
			fatigue: 0,
		} as const

		character.begin(character.scriptsContext.work.goWork(plan as unknown as WorkPlan))
		tickUntilAwayFrom(character, vehiclePosition)

		expect(character.operates).toBeUndefined()
		expect(vehicle.operator).toBeUndefined()
		expect(axialDistance(character.position, vehiclePosition)).toBeGreaterThan(0.05)
	})
})
