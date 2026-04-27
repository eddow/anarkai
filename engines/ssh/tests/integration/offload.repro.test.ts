import { registerContract } from 'ssh/types'
import { toAxialCoord } from 'ssh/utils/position'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'
import { bindOperatedWheelbarrowOffload } from '../test-engine/vehicle-bind'

describe('Offload Silent Cancellation Reproduction', () => {
	it('Reproduction: Offload work cancels silently', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		const { game } = engine

		const char = engine.spawnCharacter('Worker', { q: 3, r: 2 })
		char.role = 'worker'
		void char.scriptsContext

		try {
			// Setup target tile for offloading
			await game.requestGameplayFrontier({ q: 3, r: 2 }, 0, { maxBatchSize: 1 })
			await game.requestGameplayFrontier({ q: 4, r: 2 }, 0, { maxBatchSize: 1 })
			const targetTile = game.hex.getTile({ q: 3, r: 2 })
			if (!targetTile) throw new Error('Target tile not found')
			expect(targetTile.content).toBeDefined()
			expect(targetTile.build('storage')).toBe(true)

			// Add loose goods to the target tile
			const looseGood = game.hex.looseGoods.add(targetTile, 'wood', {
				position: targetTile.position,
			})

			const goodsAtTile = game.hex.looseGoods.getGoodsAt(targetTile.position)
			expect(goodsAtTile.some((g) => g.goodType === 'wood')).toBe(true)

			const vehicle = game.vehicles.createVehicle('wb-offload-repro', 'wheelbarrow', char.position)
			bindOperatedWheelbarrowOffload(char, vehicle)
			char.onboard()

			// Use default scriptsContext which has all scripts loaded
			const context = char.scriptsContext as any

			// Ensure scripts are loaded (it's a getter that triggers loading)
			void context

			function pathOverride() {
				return [toAxialCoord(targetTile.position)!]
			}
			function freeSpotOverride() {
				return [{ q: 4, r: 2 }]
			}
			context.find.path = registerContract(pathOverride, pathOverride)
			context.find.freeSpot = registerContract(freeSpotOverride, freeSpotOverride)

			const vehicleNs = (context as any).vehicle
			if (!vehicleNs?.vehicleOffload) throw new Error('vehicleOffload not loaded')

			// Construct Plan
			const plan = {
				type: 'work',
				job: 'vehicleOffload' as const,
				target: vehicle,
				vehicleUid: vehicle.uid,
				targetCoord: toAxialCoord(targetTile.position)!,
				maintenanceKind: 'loadFromBurden' as const,
				urgency: 1,
				fatigue: 0,
				looseGood,
				invariant: () => true,
			}

			let execution
			try {
				context.plan.begin(plan)
				vehicleNs.ensureVehicleOffloadPickupPlan(plan)
				execution = vehicleNs.vehicleOffload({ ...plan, path: [] })
			} catch (error) {
				throw new Error(
					`vehicleOffload setup failed: ${error instanceof Error ? error.message : String(error)}`
				)
			}
			let result
			try {
				result = execution.run(context)
			} catch (error) {
				throw new Error(
					`vehicleOffload initial run failed: ${error instanceof Error ? error.message : String(error)}`
				)
			}
			let loops = 0
			while (result && result.type === 'yield' && loops < 50) {
				char.update(0.1)
				const step = result.value
				if (step && typeof step.tick === 'function') {
					let ticks = 0
					while (step.status === 'pending' && ticks < 100) {
						step.tick(0.1)
						ticks++
					}
				}
				try {
					result = execution.run(context)
				} catch (error) {
					throw new Error(
						`vehicleOffload loop ${loops} failed: ${error instanceof Error ? error.message : String(error)}`
					)
				}
				loops++
			}

			const finalGoods = game.hex.looseGoods.getGoodsAt(targetTile.position)
			const carriedWood = vehicle.storage.available('wood')
			const looseWood = finalGoods.filter((g) => g.goodType === 'wood' && !g.isRemoved).length
			expect(carriedWood + looseWood).toBe(1)
		} finally {
			await engine.destroy()
		}
	})
})
