import { findVehicleOffloadJob } from 'ssh/freight/vehicle-work'
import { isVehicleOffloadService } from 'ssh/population/vehicle/vehicle'
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
			expect(job?.looseGood.goodType).toBe('mushrooms')
			expect(toAxialCoord(job!.targetCoord)).toEqual(toAxialCoord(center))
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

			expect(isVehicleOffloadService(vehicle.service)).toBe(true)
			expect(vehicle.operator?.uid).toBe(char.uid)
			expect(char.operates?.uid).toBe(vehicle.uid)
		} finally {
			await engine.destroy()
		}
	})
})
