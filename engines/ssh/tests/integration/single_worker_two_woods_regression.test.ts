import type { SaveState } from 'ssh/game'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

async function flushDeferred(turns: number = 3) {
	for (let i = 0; i < turns; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0))
	}
}

const TIMELINE_TAIL = 48
function pushTimelineSample(timeline: string[], line: string) {
	if (timeline.length >= TIMELINE_TAIL) timeline.shift()
	timeline.push(line)
}

describe('Single worker gather->sawmill regression', () => {
	it('moves and transforms two starting wood with one worker without stalling the second reserved wood', {
		timeout: 30000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'SingleWorkerGatherSawmill',
						alveoli: [
							{ coord: [0, 0], alveolus: 'freight_bay', goods: { wood: 2 } },
							{ coord: [1, 0], alveolus: 'sawmill', goods: {} },
						],
					},
				],
			}
			engine.loadScenario(scenario)
			await flushDeferred()

			const gather = engine.game.hex.getTile({ q: 0, r: 0 })?.content as any
			const sawmill = engine.game.hex.getTile({ q: 1, r: 0 })?.content as any
			expect(gather).toBeDefined()
			expect(sawmill).toBeDefined()
			if (!gather || !sawmill) throw new Error('Expected gatherer and sawmill to exist')

			const worker = engine.spawnCharacter('SoloWorker', { q: 0, r: 0 })
			worker.role = 'worker'
			worker.hunger = 0
			void worker.scriptsContext
			const action = worker.findAction()
			if (action) worker.begin(action)

			const timeline: string[] = []
			let reachedGoal = false

			const maxTicksFirst = 160
			for (let i = 0; i < maxTicksFirst; i++) {
				engine.tick(0.25)
				if (i % 8 === 0) await flushDeferred(1)

				const gatherWood = gather.storage.stock.wood || 0
				const sawmillWood = sawmill.storage.stock.wood || 0
				const sawmillPlanks = sawmill.storage.stock.planks || 0
				const movements = Array.from(gather.hive.movingGoods.values()).flat()
				const woodMovements = movements.filter((mg: any) => mg.goodType === 'wood')
				const gatherSlots = gather.storage.renderedGoods()?.slots ?? []
				const woodSlot = gatherSlots.find((slot: any) => slot.goodType === 'wood')
				const gatherReserved = woodSlot?.reserved || 0
				const sawmillSlots = sawmill.storage.renderedGoods()?.slots ?? []
				const sawmillWoodSlot = sawmillSlots.find((slot: any) => slot.goodType === 'wood')
				const sawmillReservedWood = sawmillWoodSlot?.reserved || 0
				const assigned = worker.assignedAlveolus?.name ?? 'none'

				const line = `tick=${i} gatherWood=${gatherWood} gatherReserved=${gatherReserved} sawmillWood=${sawmillWood} sawmillReservedWood=${sawmillReservedWood} planks=${sawmillPlanks} woodMovements=${woodMovements.length} assigned=${assigned} action=${worker.actionDescription.join('/') || 'none'} gatherJob=${gather.getJob?.(worker)?.job ?? 'none'} sawmillJob=${sawmill.getJob?.(worker)?.job ?? 'none'}`
				if (i % 12 === 0 || sawmillPlanks > 0 || gatherWood < 2) {
					pushTimelineSample(timeline, line)
				}

				if (sawmillPlanks >= 2 && gatherWood === 0) {
					reachedGoal = true
					break
				}
			}

			expect(reachedGoal, timeline.join('\n')).toBe(true)
			expect(sawmill.storage.stock.planks || 0, timeline.join('\n')).toBe(2)
			expect(gather.storage.stock.wood || 0, timeline.join('\n')).toBe(0)
		} finally {
			await engine.destroy()
		}
	})

	it('does not pin a single worker on incoming-only convey when a second storage also demands goods', {
		timeout: 35000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'SingleWorkerBuildDemand',
						alveoli: [
							{ coord: [0, 0], alveolus: 'freight_bay', goods: { wood: 2 } },
							{ coord: [1, 0], alveolus: 'sawmill', goods: {} },
							{ coord: [2, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
			}
			engine.loadScenario(scenario)
			await flushDeferred()

			const gather = engine.game.hex.getTile({ q: 0, r: 0 })?.content as any
			const sawmill = engine.game.hex.getTile({ q: 1, r: 0 })?.content as any
			const storage = engine.game.hex.getTile({ q: 2, r: 0 })?.content as any
			expect(gather).toBeDefined()
			expect(sawmill).toBeDefined()
			expect(storage).toBeDefined()
			if (!gather || !sawmill || !storage)
				throw new Error('Expected gather/sawmill/storage to exist')
			storage.setBuffers?.({ wood: 10, planks: 10 })
			await flushDeferred()

			const worker = engine.spawnCharacter('SoloWorker', { q: 0, r: 0 })
			worker.role = 'worker'
			void worker.scriptsContext
			const action = worker.findAction()
			if (action) worker.begin(action)

			const timeline: string[] = []
			let prolongedPinnedIncomingOnly = false
			let incomingOnlyStreak = 0
			let sawAnyProgress = false

			const maxTicksSecond = 220
			for (let i = 0; i < maxTicksSecond; i++) {
				engine.tick(0.25)
				if (i % 8 === 0) await flushDeferred(1)

				const gatherWood = gather.storage.stock.wood || 0
				const sawmillPlanks = sawmill.storage.stock.planks || 0
				const storageWood = storage.storage.stock.wood || 0
				const storagePlanks = storage.storage.stock.planks || 0
				const assigned = worker.assignedAlveolus?.name ?? 'none'
				const actionDesc = worker.actionDescription.join('/') || 'none'
				const hasAGoodMovement = !!(worker.assignedAlveolus?.aGoodMovement?.length ?? 0)
				const incoming = !!worker.assignedAlveolus?.incomingGoods
				const waitIncoming = actionDesc.includes('waitForIncomingGoods')

				if (sawmillPlanks > 0 || storageWood > 0 || storagePlanks > 0 || gatherWood < 2) {
					sawAnyProgress = true
				}

				const incomingOnly = waitIncoming && incoming && !hasAGoodMovement
				if (incomingOnly) incomingOnlyStreak += 1
				else incomingOnlyStreak = 0
				if (incomingOnlyStreak >= 24) prolongedPinnedIncomingOnly = true // ~6s

				const line2 = `tick=${i} gatherWood=${gatherWood} sawmillPlanks=${sawmillPlanks} storageWood=${storageWood} storagePlanks=${storagePlanks} assigned=${assigned} incoming=${incoming} hasMove=${hasAGoodMovement} action=${actionDesc}`
				if (incomingOnlyStreak > 0 || incomingOnly || i % 16 === 0) {
					pushTimelineSample(timeline, line2)
				}
			}

			expect(prolongedPinnedIncomingOnly, timeline.join('\n')).toBe(false)
			expect(sawAnyProgress, timeline.join('\n')).toBe(true)
		} finally {
			await engine.destroy()
		}
	})
})
