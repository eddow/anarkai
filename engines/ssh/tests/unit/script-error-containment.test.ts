// @ts-nocheck
import { registerContract } from 'ssh/types'
import { toAxialCoord } from 'ssh/utils/position'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'
import { bindOperatedWheelbarrowOffload } from '../test-engine/vehicle-bind'

/**
 * A script execution error (e.g. `error "No path to vehicleOffload pickup tile"`)
 * is a recoverable NPC failure, not a fatal one. It must be contained by
 * `nextStep` so it never escapes into the mutts batch (the game tick runs inside
 * an effect) — otherwise it breaks the reactive system and every downstream write
 * (zone deletion, settlement generation, hover) throws `ReactiveError: broken`.
 */
describe('script error containment', () => {
	it('nextStep contains a vehicleOffload "no path" error and keeps the reactive system intact', async () => {
		// The contained script error is still reported via the `script` trace
		// channel (that's how the recovery is observable), so allow it here.
		;(globalThis as any).allowExpectedDiagnostics?.(/script\.makeRun\.error/)

		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		const { game } = engine

		try {
			const char = engine.spawnCharacter('Worker', { q: 3, r: 2 })
			await game.requestGameplayFrontier({ q: 3, r: 2 }, 0, { maxBatchSize: 1 })
			const targetTile = game.hex.getTile({ q: 3, r: 2 })
			if (!targetTile) throw new Error('Target tile not found')
			const looseGood = game.hex.looseGoods.add(targetTile, 'wood', {
				position: targetTile.position,
			})
			const vehicle = game.vehicles.createVehicle('wheelbarrow', char.position)
			bindOperatedWheelbarrowOffload(char, vehicle, {
				kind: 'loadFromBurden',
				looseGood,
				targetCoord: toAxialCoord(targetTile.position),
			})
			char.onboard()

			const context = char.scriptsContext as any
			// Force pathfinding to report "no path" so `vehicleOffload` throws.
			context.find.path = registerContract(
				() => undefined,
				() => undefined
			)

			const plan = {
				type: 'work',
				job: 'vehicleOffload',
				target: vehicle,
				vehicle,
				targetCoord: toAxialCoord(targetTile.position),
				maintenanceKind: 'loadFromBurden',
				urgency: 1,
				fatigue: 0,
				looseGood,
				invariant: () => true,
			}
			context.plan.begin(plan)
			context.vehicle.ensureVehicleOffloadPickupPlan(plan)
			const execution = context.vehicle.vehicleOffload({ ...plan, path: [] })

			char.runningScripts = [execution]

			// The script error must be contained: `nextStep` recovers with a ponder
			// step instead of letting the error escape into the mutts batch.
			expect(() => char.nextStep()).not.toThrow()
			expect(char.stepExecutor).toBeDefined()

			// The reactive system must still be intact — a further tick must not
			// surface a "Root batch failure" / broken-system error.
			expect(() => engine.tick(0.1)).not.toThrow()
		} finally {
			await engine.destroy()
		}
	})
})
