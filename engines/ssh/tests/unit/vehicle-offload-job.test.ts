import {
	allocateVehicleServiceForJob,
	findVehicleHopJob,
	findVehicleOffloadJob,
} from 'ssh/freight/vehicle-work'
import { VehicleEntity } from 'ssh/population/vehicle/entity'
import { isVehicleMaintenanceService } from 'ssh/population/vehicle/vehicle'
import { toAxialCoord } from 'ssh/utils/position'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('findVehicleOffloadJob', () => {
	it('returns vehicleOffload for a burdened alveolus when a wheelbarrow is in range', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		const { game } = engine
		try {
			const center = { q: 2, r: 2 }
			engine.loadScenario({
				generationOptions: { terrainSeed: 1234, characterCount: 0 },
				looseGoods: [{ goodType: 'mushrooms', position: center }],
				hives: [
					{
						name: 'Hive',
						alveoli: [{ coord: [2, 2], alveolus: 'tree_chopper', goods: {} }],
					},
				],
			} as any)
			game.vehicles.createVehicle('wb-unit', 'wheelbarrow', center, [])
			const char = engine.spawnCharacter('Worker', center)
			void char.scriptsContext
			const job = findVehicleOffloadJob(game, char)
			expect(job?.job).toBe('vehicleOffload')
			expect(job?.maintenanceKind).toBe('loadFromBurden')
			if (job?.maintenanceKind !== 'loadFromBurden') throw new Error('expected loadFromBurden')
			expect(job.looseGood.goodType).toBe('mushrooms')
			expect(toAxialCoord(job.targetCoord)).toEqual(toAxialCoord(center))
		} finally {
			await engine.destroy()
		}
	})

	it('returns undefined when no wheelbarrow exists within offload workflow', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		const { game } = engine
		try {
			const center = { q: 2, r: 2 }
			engine.loadScenario({
				generationOptions: { terrainSeed: 1234, characterCount: 0 },
				looseGoods: [{ goodType: 'mushrooms', position: center }],
				hives: [
					{
						name: 'Hive',
						alveoli: [{ coord: [2, 2], alveolus: 'tree_chopper', goods: {} }],
					},
				],
			} as any)
			const char = engine.spawnCharacter('Worker', center)
			void char.scriptsContext
			expect(findVehicleOffloadJob(game, char)).toBeUndefined()
		} finally {
			await engine.destroy()
		}
	})

	it('binds offload service as soon as the offload plan begins', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		const { game } = engine
		try {
			const center = { q: 2, r: 2 }
			engine.loadScenario({
				generationOptions: { terrainSeed: 1234, characterCount: 0 },
				looseGoods: [{ goodType: 'mushrooms', position: center }],
				hives: [
					{
						name: 'Hive',
						alveoli: [{ coord: [2, 2], alveolus: 'tree_chopper', goods: {} }],
					},
				],
			} as any)
			const vehicle = game.vehicles.createVehicle('wb-unit', 'wheelbarrow', center, [])
			const char = engine.spawnCharacter('Worker', center)
			void char.scriptsContext

			const action = char.findBestJob()
			expect(action).toBeTruthy()
			if (!action) throw new Error('Expected vehicleOffload action')
			char.begin(action)

			expect(isVehicleMaintenanceService(vehicle.service)).toBe(true)
			expect(vehicle.operator?.uid).toBe(char.uid)
			expect(char.operates?.uid).toBe(vehicle.uid)
		} finally {
			await engine.destroy()
		}
	})

	it('prefers load maintenance over unload when both are actionable', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		const { game } = engine
		try {
			const center = { q: 2, r: 2 }
			engine.loadScenario({
				generationOptions: { terrainSeed: 1234, characterCount: 0 },
				looseGoods: [{ goodType: 'stone', position: center }],
				hives: [
					{
						name: 'PriorityHive',
						alveoli: [{ coord: [2, 2], alveolus: 'storage', goods: {} }],
					},
				],
			} as any)
			game.vehicles
				.createVehicle('wb-priority', 'wheelbarrow', center, [])
				.storage.addGood('stone', 1)
			const char = engine.spawnCharacter('Worker', center)
			void char.scriptsContext

			const job = findVehicleOffloadJob(game, char)
			expect(job?.job).toBe('vehicleOffload')
			expect(job?.maintenanceKind).toBe('loadFromBurden')
		} finally {
			await engine.destroy()
		}
	})

	it('returns unloadToTile for an idle loaded wheelbarrow with no higher-priority burden to clear', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		const { game } = engine
		try {
			const center = { q: 2, r: 2 }
			engine.loadScenario({
				generationOptions: { terrainSeed: 1234, characterCount: 0 },
				tiles: [
					{ coord: [2, 2], terrain: 'grass' },
					{ coord: [2, 3], terrain: 'grass' },
					{ coord: [3, 2], terrain: 'grass' },
				],
			} as any)
			const vehicle = game.vehicles.createVehicle('wb-unload', 'wheelbarrow', center, [])
			vehicle.storage.addGood('stone', 1)
			const char = engine.spawnCharacter('Worker', center)
			void char.scriptsContext

			const job = findVehicleOffloadJob(game, char)
			expect(job?.job).toBe('vehicleOffload')
			expect(job?.maintenanceKind).toBe('unloadToTile')
			expect(job?.targetCoord).not.toEqual(center)
		} finally {
			await engine.destroy()
		}
	})

	it('prefers a nearby unload target over a much farther burdening load target', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		const { game } = engine
		try {
			engine.loadScenario({
				generationOptions: { terrainSeed: 1234, characterCount: 0 },
				tiles: [
					{ coord: [0, 0], terrain: 'grass' },
					{ coord: [0, 1], terrain: 'grass' },
					{ coord: [6, 0], terrain: 'grass' },
					{ coord: [6, 1], terrain: 'grass' },
				],
				hives: [
					{
						name: 'FarAlveolusHive',
						alveoli: [{ coord: [6, 0], alveolus: 'storage', goods: {} }],
					},
				],
				looseGoods: [{ goodType: 'stone', position: { q: 6, r: 0 } }],
			} as any)
			const vehicle = game.vehicles.createVehicle(
				'wb-near-unload',
				'wheelbarrow',
				{ q: 0, r: 0 },
				[]
			)
			vehicle.storage.addGood('stone', 1)
			const char = engine.spawnCharacter('Worker', { q: 0, r: 0 })
			void char.scriptsContext

			const job = findVehicleOffloadJob(game, char)
			expect(job?.job).toBe('vehicleOffload')
			expect(job?.maintenanceKind).toBe('unloadToTile')
			expect(job?.targetCoord).toEqual({ q: 0, r: 1 })
		} finally {
			await engine.destroy()
		}
	})

	it('does not surface maintenance offload when the same project wood should start a served gather line', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		const { game } = engine
		try {
			engine.loadScenario({
				generationOptions: { terrainSeed: 1234, characterCount: 0 },
				tiles: [
					{ coord: [0, 0], terrain: 'concrete' },
					{ coord: [0, 1], terrain: 'concrete' },
					{ coord: [1, 0], terrain: 'concrete' },
					{ coord: [2, 0], terrain: 'grass' },
					{ coord: [1, 1], terrain: 'grass' },
				],
				hives: [
					{
						name: 'JointPriorityHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'freight_bay', goods: {} },
							{ coord: [1, 0], alveolus: 'sawmill', goods: {} },
						],
					},
				],
				projects: {
					'build:storage': [[2, 0] as [number, number]],
				},
				looseGoods: [
					{ goodType: 'wood', position: { q: 2, r: 0 } },
					{ goodType: 'wood', position: { q: 1, r: 1 } },
				],
				freightLines: [
					{
						id: 'joint-priority-line',
						name: 'Joint priority line',
						stops: [
							{ id: 'load', zone: { kind: 'radius', center: [0, 0], radius: 3 } },
							{
								id: 'unload',
								anchor: {
									kind: 'alveolus',
									hiveName: 'JointPriorityHive',
									alveolusType: 'freight_bay',
									coord: [0, 0],
								},
							},
						],
						filters: ['wood'],
					},
				],
			} as any)
			const line = game.freightLines[0]!
			game.vehicles.createVehicle('wb-joint', 'wheelbarrow', { q: 0, r: 0 }, [line])
			const char = engine.spawnCharacter('Worker', { q: 0, r: 1 })
			void char.scriptsContext

			expect(findVehicleOffloadJob(game, char)).toBeUndefined()
			const hop = findVehicleHopJob(game, char)
			expect(hop?.job).toBe('vehicleHop')
		} finally {
			await engine.destroy()
		}
	})

	it('returns park for an idle empty wheelbarrow burdening an alveolus tile', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		const { game } = engine
		try {
			const center = { q: 2, r: 2 }
			engine.loadScenario({
				generationOptions: { terrainSeed: 1234, characterCount: 0 },
				hives: [
					{
						name: 'ParkHive',
						alveoli: [{ coord: [2, 2], alveolus: 'storage', goods: {} }],
					},
				],
			} as any)
			game.vehicles.createVehicle('wb-park', 'wheelbarrow', center, [])
			const char = engine.spawnCharacter('Worker', center)
			void char.scriptsContext

			const job = findVehicleOffloadJob(game, char)
			expect(job?.job).toBe('vehicleOffload')
			expect(job?.maintenanceKind).toBe('park')
			expect(job?.targetCoord).not.toEqual(center)
		} finally {
			await engine.destroy()
		}
	})

	it('allocates unload and park maintenance services from the job hint', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		const { game } = engine
		try {
			const center = { q: 2, r: 2 }
			engine.loadScenario({
				generationOptions: { terrainSeed: 1234, characterCount: 0 },
				tiles: [{ coord: [2, 2], terrain: 'grass' }],
			} as any)
			const vehicle = game.vehicles.createVehicle('wb-hint', 'wheelbarrow', center, [])
			const char = engine.spawnCharacter('Worker', center)
			void char.scriptsContext

			allocateVehicleServiceForJob(game, char, vehicle, {
				job: 'vehicleOffload',
				urgency: 1,
				fatigue: 1,
				vehicleUid: vehicle.uid,
				targetCoord: { q: 3, r: 2 },
				path: [],
				maintenanceKind: 'unloadToTile',
			})
			expect(isVehicleMaintenanceService(vehicle.service)).toBe(true)
			expect(vehicle.service?.kind).toBe('unloadToTile')
			if (!isVehicleMaintenanceService(vehicle.service))
				throw new Error('expected maintenance service')
			expect(vehicle.service.targetCoord).toEqual({ q: 3, r: 2 })
			expect(vehicle.service.operator?.uid).toBe(char.uid)

			allocateVehicleServiceForJob(game, char, vehicle, {
				job: 'vehicleOffload',
				urgency: 1,
				fatigue: 1,
				vehicleUid: vehicle.uid,
				targetCoord: { q: 1, r: 2 },
				path: [],
				maintenanceKind: 'park',
			})
			expect(isVehicleMaintenanceService(vehicle.service)).toBe(true)
			expect(vehicle.service?.kind).toBe('park')
			if (!isVehicleMaintenanceService(vehicle.service))
				throw new Error('expected maintenance service')
			expect(vehicle.service.targetCoord).toEqual({ q: 1, r: 2 })
			expect(vehicle.service.operator?.uid).toBe(char.uid)
		} finally {
			await engine.destroy()
		}
	})

	it('serializes maintenance services explicitly and drops them on deserialize', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		const { game } = engine
		try {
			const center = { q: 2, r: 2 }
			engine.loadScenario({
				generationOptions: { terrainSeed: 1234, characterCount: 0 },
				tiles: [{ coord: [2, 2], terrain: 'grass' }],
			} as any)
			const vehicle = game.vehicles.createVehicle('wb-save', 'wheelbarrow', center, [])
			vehicle.storage.addGood('wood', 2)
			const char = engine.spawnCharacter('Worker', center)
			void char.scriptsContext

			vehicle.beginMaintenanceService({ kind: 'unloadToTile', targetCoord: { q: 3, r: 2 } }, char)
			const saved = vehicle.serialize()
			expect(saved.service).toEqual({
				kind: 'maintenance',
				maintenanceKind: 'unloadToTile',
				targetCoord: { q: 3, r: 2 },
				operatorUid: char.uid,
			})

			const restored = VehicleEntity.deserialize(game, saved)
			expect(restored.service).toBeUndefined()
			expect(restored.storage.stock.wood).toBe(2)

			const legacyRestored = VehicleEntity.deserialize(game, {
				uid: 'wb-legacy-offload',
				vehicleType: 'wheelbarrow',
				position: center,
				servedLineIds: [],
				service: { kind: 'offload', operatorUid: char.uid },
			})
			expect(legacyRestored.service).toBeUndefined()
		} finally {
			await engine.destroy()
		}
	})
})
