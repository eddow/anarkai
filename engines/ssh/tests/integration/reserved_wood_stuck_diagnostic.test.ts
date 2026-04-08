import type { SaveState } from 'ssh/game'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

async function flushDeferred(turns: number = 3) {
	for (let i = 0; i < turns; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0))
	}
}

describe('Reserved wood stuck diagnostic', () => {
	it('does not leave reserved wood at gather without a convey movement or convey job for long', {
		timeout: 20000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'ReservedWoodDiagnosticHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'gather', goods: {} },
							{ coord: [1, 0], alveolus: 'sawmill', goods: {} },
						],
					},
				],
				looseGoods: [
					{ position: { q: 0, r: 1 }, goodType: 'wood' },
					{ position: { q: 0, r: 1 }, goodType: 'wood' },
				],
			}

			engine.loadScenario(scenario)
			await flushDeferred()

			const gather = engine.game.hex.getTile({ q: 0, r: 0 })?.content as any
			const sawmill = engine.game.hex.getTile({ q: 1, r: 0 })?.content as any
			expect(gather).toBeDefined()
			expect(sawmill).toBeDefined()
			if (!gather || !sawmill) throw new Error('Expected gatherer and sawmill to exist')

			const spawnWorker = (name: string, coord: { q: number; r: number }) => {
				const worker = engine.spawnCharacter(name, coord)
				worker.role = 'worker'
				void worker.scriptsContext
				const action = worker.findAction()
				if (action) worker.begin(action)
				return worker
			}

			const gatherWorker = spawnWorker('GatherWorker', { q: 0, r: 0 })
			const sawmillWorker = spawnWorker('SawmillWorker', { q: 1, r: 0 })

			const timeline: string[] = []
			let consecutiveStuckTicks = 0
			let maxReserved = 0

			for (let i = 0; i < 160; i++) {
				engine.tick(0.25)
				if (i % 4 === 0) await flushDeferred(1)

				const gatherSlots = gather.storage.renderedGoods()?.slots ?? []
				const woodSlot = gatherSlots.find((slot: any) => slot.goodType === 'wood')
				const gatherStock = gather.storage.stock.wood || 0
				const gatherReserved = woodSlot?.reserved || 0
				const gatherJob = gather.getJob(gatherWorker)?.job ?? 'none'
				const sawmillJob = sawmill.getJob(sawmillWorker)?.job ?? 'none'
				const woodMovements = Array.from(gather.hive.movingGoods.values())
					.flat()
					.filter((movement: any) => movement.goodType === 'wood').length
				const stuck =
					gatherReserved > 0 &&
					gatherStock > 0 &&
					woodMovements === 0 &&
					gatherJob !== 'convey' &&
					sawmillJob !== 'convey'

				maxReserved = Math.max(maxReserved, gatherReserved)
				consecutiveStuckTicks = stuck ? consecutiveStuckTicks + 1 : 0

				timeline.push(
					`tick=${i} gatherStock=${gatherStock} gatherReserved=${gatherReserved} woodMovements=${woodMovements} gatherJob=${gatherJob} sawmillJob=${sawmillJob} gatherAction=${gatherWorker.actionDescription.join('/') || 'none'} sawmillAction=${sawmillWorker.actionDescription.join('/') || 'none'} stuckRun=${consecutiveStuckTicks}`
				)

				if (consecutiveStuckTicks >= 8) {
					throw new Error(
						`Reserved wood got stuck without convey visibility.\n${timeline.slice(-40).join('\n')}`
					)
				}
			}

			expect(maxReserved, timeline.join('\n')).toBeGreaterThan(0)
		} finally {
			await engine.destroy()
		}
	})
})
