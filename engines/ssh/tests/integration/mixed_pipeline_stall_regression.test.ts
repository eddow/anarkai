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

describe('Mixed pipeline stall regression', () => {
	it('keeps some convey work visible while wood-in and plank-out logistics overlap', {
		timeout: 35000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'MixedPipelineHive',
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
			let stalledMixedPipeline = false
			let stallStreak = 0

			const maxTicks = 280
			for (let i = 0; i < maxTicks; i++) {
				engine.tick(0.25)
				if (i % 8 === 0) await flushDeferred(1)

				const gatherSlots = gather.storage.renderedGoods()?.slots ?? []
				const gatherWoodSlot = gatherSlots.find((slot: any) => slot.goodType === 'wood')
				const gatherReservedWood = gatherWoodSlot?.reserved || 0

				const movements = Array.from(gather.hive.movingGoods.entries()).flatMap(
					([coord, goods]: [unknown, any[]]) =>
						goods.map((movement) => ({
							goodType: movement.goodType,
							from: movement.from,
							pathLength: movement.path.length,
							claimed: movement.claimed,
							provider: movement.provider?.name ?? 'unknown',
							demander: movement.demander?.name ?? 'unknown',
							coord,
						}))
				)
				const plankInTransit = movements.some((movement) => movement.goodType === 'planks')
				const anyVisibleConveyJob = [gather, sawmill, storage].some(
					(alveolus) => alveolus.getJob?.(worker)?.job === 'convey'
				)

				const actionDesc = worker.actionDescription.join('/') || 'none'
				const mixedPipelineStall = gatherReservedWood > 0 && plankInTransit && !anyVisibleConveyJob
				const line = `tick=${i} gatherReservedWood=${gatherReservedWood} plankInTransit=${plankInTransit} visibleConvey=${anyVisibleConveyJob} action=${actionDesc} assigned=${worker.assignedAlveolus?.name ?? 'none'} movements=${movements.map((movement) => `${movement.goodType}:${movement.provider}->${movement.demander}:claimed=${movement.claimed}:path=${movement.pathLength}`).join(',') || 'none'}`
				if (mixedPipelineStall || stallStreak > 0 || i % 16 === 0) {
					pushTimelineSample(timeline, line)
				}

				if (mixedPipelineStall) stallStreak += 1
				else stallStreak = 0

				if (stallStreak >= 8) {
					stalledMixedPipeline = true
					break
				}
			}

			expect(stalledMixedPipeline, timeline.join('\n')).toBe(false)
		} finally {
			await engine.destroy()
		}
	})
})
