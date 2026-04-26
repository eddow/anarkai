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
	findVehicleOffloadJob,
	findZoneBrowseJob,
} from 'ssh/freight/vehicle-work'
import type { GamePatches } from 'ssh/game/game'
import { Game } from 'ssh/game/game'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { isVehicleLineService, isVehicleMaintenanceService } from 'ssh/population/vehicle/vehicle'
import type { WorkPlan } from 'ssh/types/base'
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
		expect(isVehicleMaintenanceService(vehicle.service)).toBe(true)
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

	it('does not begin a line while an unfinished maintenance service is bound', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
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
			looseGoods: [{ goodType: 'wood' as const, position: { q: 1, r: 0 } }],
		}
		game = new Game({ terrainSeed: 9404, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('vb', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('Begin', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()

		expect(findVehicleBeginServiceJob(game, character)).toBeUndefined()
		expect(findVehicleHopJob(game, character)).toBeUndefined()
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

	it('prefers a project-tile load that also serves the line over a plain pure-line gather', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
				{ coord: [2, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 1] as const, terrain: 'grass' as const },
			],
			hives: [
				{
					name: 'JointPriority',
					alveoli: [
						{ coord: [0, 0] as const, alveolus: 'freight_bay', goods: {} },
						{ coord: [1, 0] as const, alveolus: 'sawmill', goods: {} },
					],
				},
			],
			projects: {
				'build:storage': [[2, 0] as [number, number]],
			},
			looseGoods: [
				{ goodType: 'wood' as const, position: { q: 2, r: 0 } },
				{ goodType: 'wood' as const, position: { q: 1, r: 1 } },
			],
			freightLines: [
				gatherFreightLine({
					id: 'VH:joint-priority',
					name: 'Joint priority',
					hiveName: 'JointPriority',
					coord: [0, 0],
					filters: ['wood'],
					radius: 3,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 94055, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const zoneStop = line.stops[0]!
		const vehicle = game.vehicles.createVehicle('joint-zone', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('JointBrowse', { q: 0, r: 0 })
		vehicle.beginLineService(line, zoneStop, character)
		character.operates = vehicle
		character.onboard()

		const job = findZoneBrowseJob(game, character)
		expect(job?.job).toBe('zoneBrowse')
		expect(job?.zoneBrowseAction).toBe('load')
		expect(job?.targetCoord).toMatchObject({ q: 2, r: 0 })
		expect(job?.adSource).toBe('project')
		expect(job?.priorityTier).toBe('lineAndOffloadJoint')
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

	it('work-plan finalizer releases a line operator while preserving unfinished service', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
			freightLines: [
				gatherFreightLine({
					id: 'VH:lifecycle-line',
					name: 'Lifecycle line',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9407, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const stop = line.stops[0]!
		const vehicle = game.vehicles.createVehicle('vlifecycle', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('Lifecycle', { q: 0, r: 0 })
		const plan = {
			type: 'work',
			job: 'zoneBrowse',
			vehicleUid: vehicle.uid,
			target: vehicle,
			path: [],
			lineId: line.id,
			stopId: stop.id,
			zoneBrowseAction: 'load',
			goodType: 'wood',
			quantity: 1,
			targetCoord: { q: 1, r: 0 },
			adSource: 'hive',
			priorityTier: 'pureLine',
			urgency: 1,
			fatigue: 0,
		} as const

		vehicle.beginLineService(line, stop)
		character.scriptsContext.plan.begin(plan as any)
		expect(character.operates?.uid).toBe(vehicle.uid)
		expect(vehicle.operator?.uid).toBe(character.uid)

		character.scriptsContext.plan.finally(plan as any)

		expect(character.operates).toBeUndefined()
		expect(vehicle.operator).toBeUndefined()
		const serviceAfterRelease = vehicle.service
		expect(isVehicleLineService(serviceAfterRelease)).toBe(true)
		if (!isVehicleLineService(serviceAfterRelease)) throw new Error('Expected line service')
		expect(serviceAfterRelease.stop.id).toBe(stop.id)
	})

	it('work-plan finalizer preserves unfinished maintenance service for another operator', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9408, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('vmaint', 'wheelbarrow', { q: 0, r: 0 }, [])
		vehicle.storage.addGood('wood', 1)
		const character = game.population.createCharacter('Maintenance', { q: 0, r: 0 })
		const plan = {
			type: 'work',
			job: 'vehicleOffload',
			maintenanceKind: 'unloadToTile',
			vehicleUid: vehicle.uid,
			target: vehicle,
			path: [],
			targetCoord: { q: 1, r: 0 },
			urgency: 1,
			fatigue: 0,
		} as const

		character.scriptsContext.plan.begin(plan as any)
		expect(character.operates?.uid).toBe(vehicle.uid)
		expect(vehicle.operator?.uid).toBe(character.uid)

		character.scriptsContext.plan.finally(plan as any)

		expect(character.operates).toBeUndefined()
		expect(vehicle.operator).toBeUndefined()
		const serviceAfterRelease = vehicle.service
		expect(isVehicleMaintenanceService(serviceAfterRelease)).toBe(true)
		if (!isVehicleMaintenanceService(serviceAfterRelease))
			throw new Error('Expected maintenance service')
		expect(serviceAfterRelease.kind).toBe('unloadToTile')
	})

	it('explicit maintenance completion ends service before work-plan cleanup', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9409, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('vcomplete', 'wheelbarrow', { q: 0, r: 0 }, [])
		const character = game.population.createCharacter('Complete', { q: 0, r: 0 })
		const plan = {
			type: 'work',
			job: 'vehicleOffload',
			maintenanceKind: 'park',
			vehicleUid: vehicle.uid,
			target: vehicle,
			path: [],
			targetCoord: { q: 1, r: 0 },
			urgency: 1,
			fatigue: 0,
		} as const

		character.scriptsContext.plan.begin(plan as any)
		expect(character.operates?.uid).toBe(vehicle.uid)
		expect(isVehicleMaintenanceService(vehicle.service)).toBe(true)

		character.scriptsContext.vehicle.completeVehicleMaintenanceService(plan as any)
		character.scriptsContext.plan.finally(plan as any)

		expect(character.operates).toBeUndefined()
		expect(vehicle.operator).toBeUndefined()
		expect(vehicle.service).toBeUndefined()
	})

	it('maintenance unload transfer keeps operator link until explicit completion', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9410, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle(
			'vunload-lifecycle',
			'wheelbarrow',
			{ q: 0, r: 0 },
			[]
		)
		vehicle.storage.addGood('wood', 1)
		const character = game.population.createCharacter('UnloadLifecycle', { q: 0, r: 0 })
		const plan: WorkPlan = {
			type: 'work',
			job: 'vehicleOffload',
			maintenanceKind: 'unloadToTile',
			vehicleUid: vehicle.uid,
			target: vehicle,
			path: [],
			targetCoord: { q: 0, r: 0 },
			urgency: 1,
			fatigue: 0,
		}

		character.scriptsContext.plan.begin(plan)
		const step = character.scriptsContext.vehicle.vehicleUnloadTransferStep(plan)
		if (!step || !('tick' in step)) throw new Error('Expected unload transfer step')
		step.tick(999)

		expect(character.operates?.uid).toBe(vehicle.uid)
		expect(vehicle.operator?.uid).toBe(character.uid)
		expect(isVehicleMaintenanceService(vehicle.service)).toBe(true)

		character.scriptsContext.vehicle.completeVehicleMaintenanceService(plan)

		expect(character.operates).toBeUndefined()
		expect(vehicle.operator).toBeUndefined()
		expect(vehicle.service).toBeUndefined()
	})

	it('zoneBrowse transfer dispatch uses native helpers without relying on this-bound siblings', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			looseGoods: [{ goodType: 'wood' as const, position: { q: 0, r: 0 } }],
			freightLines: [
				gatherFreightLine({
					id: 'VH:native-dispatch',
					name: 'Native dispatch',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 1,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9411, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const stop = line.stops[0]!
		const vehicle = game.vehicles.createVehicle('vnative-dispatch', 'wheelbarrow', { q: 0, r: 0 }, [
			line,
		])
		const character = game.population.createCharacter('NativeDispatch', { q: 0, r: 0 })
		vehicle.beginLineService(line, stop, character)
		character.operates = vehicle
		const plan: WorkPlan = {
			type: 'work',
			job: 'zoneBrowse',
			vehicleUid: vehicle.uid,
			target: vehicle,
			path: [],
			lineId: line.id,
			stopId: stop.id,
			zoneBrowseAction: 'load',
			goodType: 'wood',
			quantity: 1,
			targetCoord: { q: 0, r: 0 },
			adSource: 'hive',
			priorityTier: 'pureLine',
			urgency: 1,
			fatigue: 0,
		}

		const step = character.scriptsContext.vehicle.vehicleZoneBrowseTransferStep(plan)

		expect(step).toBeTruthy()
		step?.cancel()
		expect(character.operates?.uid).toBe(vehicle.uid)
		expect(vehicle.operator?.uid).toBe(character.uid)
	})

	it('non-vehicle work plan releases stale vehicle usage before preparing work', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9412, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle(
			'vnon-vehicle-plan',
			'wheelbarrow',
			{ q: 0, r: 0 },
			[]
		)
		const character = game.population.createCharacter('NonVehiclePlan', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()
		const target = game.hex.getTile({ q: 0, r: 0 })!.content!
		const plan = {
			type: 'work',
			job: 'harvest',
			target,
			path: [],
			urgency: 1,
			fatigue: 0,
		} as const

		character.scriptsContext.plan.begin(plan as any)

		expect(character.operates).toBeUndefined()
		expect(vehicle.operator).toBeUndefined()
		expect(vehicle.service).toBeDefined()
	})

	it('self-care selection releases stale vehicle usage before returning eat/rest activity', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9413, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('vself-care', 'wheelbarrow', { q: 0, r: 0 }, [])
		const character = game.population.createCharacter('SelfCare', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()
		character.hunger = character.triggerLevels.hunger.critical + 1

		const action = character.findAction()

		expect(action).toBeTruthy()
		expect(character.operates).toBeUndefined()
		expect(vehicle.operator).toBeUndefined()
		expect(vehicle.service).toBeDefined()
	})

	it('disengaging after vehicle movement restores the character foot tile at the vehicle location', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9414, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('vfoot-sync', 'wheelbarrow', { q: 0, r: 0 }, [])
		const character = game.population.createCharacter('FootSync', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()
		character.position = { q: 1, r: 0 }

		character.disengageVehicleKeepingService()

		expect(character.operates).toBeUndefined()
		expect(toAxialCoord(character.position)).toMatchObject({ q: 1, r: 0 })
		expect(toAxialCoord(character.tile.position)).toMatchObject({ q: 1, r: 0 })
	})

	it('unfinished maintenance service without operator is offered to another worker', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9415, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle(
			'vresume-maintenance',
			'wheelbarrow',
			{ q: 0, r: 0 },
			[]
		)
		vehicle.storage.addGood('wood', 1)
		vehicle.beginMaintenanceService({ kind: 'unloadToTile', targetCoord: { q: 1, r: 0 } })
		const character = game.population.createCharacter('ResumeMaintenance', { q: 1, r: 0 })

		const job = findVehicleOffloadJob(game, character)

		expect(job?.job).toBe('vehicleOffload')
		expect(job?.maintenanceKind).toBe('unloadToTile')
		expect(job?.vehicleUid).toBe(vehicle.uid)
	})
})
