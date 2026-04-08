import type { AlveolusGate } from 'ssh/board/border/alveolus-gate'
import type { Alveolus } from 'ssh/board/content/alveolus'
import type { TransferPlan } from 'ssh/types/base'
import { afterEach, describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine/engine'

describe('Drop plan reservations', () => {
	let engine: TestEngine | undefined

	afterEach(async () => {
		await engine?.destroy()
		engine = undefined
	})

	it('reserves gate storage only when the drop is effectuated', async () => {
		engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()

		engine.loadScenario({
			generationOptions: {
				terrainSeed: 1234,
				characterCount: 0,
			},
			hives: [
				{
					name: 'TestHive',
					alveoli: [
						{ coord: [0, 0], alveolus: 'storage', goods: {} },
						{ coord: [1, 0], alveolus: 'storage', goods: {} },
					],
				},
			],
		} as any)

		const left = engine.game.hex.getTile({ q: 0, r: 0 })!.content as Alveolus
		const right = engine.game.hex.getTile({ q: 1, r: 0 })!.content as Alveolus
		const gate = left.gates.find(
			(candidate) => candidate.alveolusA === right || candidate.alveolusB === right
		) as AlveolusGate | undefined
		expect(gate).toBeDefined()
		if (!gate) throw new Error('Expected adjacent alveoli to share a gate')

		const worker = engine.spawnCharacter('Carrier', { q: 0, r: 0 })
		worker.vehicle.storage.addGood('wood', 1)

		const plan = worker.scriptsContext.inventory.planDropStored(
			{ wood: 1 },
			gate.border
		) as TransferPlan

		worker.scriptsContext.plan.begin(plan)
		expect(plan.vehicleAllocation).toBeUndefined()
		expect(plan.allocation).toBeUndefined()
		expect(gate.storage.allocatedSlots).toBe(false)

		const step = worker.scriptsContext.inventory.effectuate(plan)
		expect(plan.vehicleAllocation).toBeDefined()
		expect(plan.allocation).toBeDefined()
		expect(gate.storage.allocatedSlots).toBe(true)

		step.finish()
		expect(gate.storage.allocatedSlots).toBe(false)
		expect(gate.storage.stock.wood).toBe(1)
		expect(worker.vehicle.storage.stock.wood ?? 0).toBe(0)

		worker.scriptsContext.plan.finally(plan)
	})
})
