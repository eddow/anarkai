import type { SaveState } from 'ssh/game'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

async function flushDeferred(turns: number = 3) {
	for (let i = 0; i < turns; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0))
	}
}

describe('Assigned second wood debug', () => {
	it('tracks an assigned gather worker across first and second wood conveyance', {
		timeout: 20000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'AssignedSecondWoodHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'gather', goods: { wood: 2 } },
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
			if (!gather || !sawmill) throw new Error('Expected gather and sawmill')

			const gatherWorker = engine.spawnCharacter('GatherWorker', { q: 0, r: 0 })
			gatherWorker.role = 'worker'
			void gatherWorker.scriptsContext
			gatherWorker.assignedAlveolus = gather
			gather.assignedWorker = gatherWorker

			const firstAction = gatherWorker.findAction()
			expect(firstAction?.name).toBe('work.goWork')

			const timeline: string[] = []
			const errors: string[] = []
			const originalError = console.error
			console.error = (...args: any[]) => {
				errors.push(args.map((arg) => String(arg)).join(' '))
				originalError(...args)
			}

			try {
				gatherWorker.begin(firstAction!)
				let consumedSecondWood = false

				for (let i = 0; i < 80; i++) {
					engine.tick(0.25)
					if (i % 4 === 0) await flushDeferred(1)

					const woodMovements = Array.from(gather.hive.movingGoods.values())
						.flat()
						.filter((movement: any) => movement.goodType === 'wood')

					timeline.push(
						`tick=${i} gatherStock=${gather.storage.stock.wood || 0} gatherReserved=${gather.storage.renderedGoods()?.slots?.find((slot: any) => slot.goodType === 'wood')?.reserved || 0} sawmillWood=${sawmill.storage.stock.wood || 0} sawmillPlanks=${sawmill.storage.stock.planks || 0} gatherJob=${gather.getJob(gatherWorker)?.job ?? 'none'} gatherAction=${gatherWorker.actionDescription.join('/') || 'none'} gatherAssigned=${gatherWorker.assignedAlveolus === gather} alveolusAssigned=${gather.assignedWorker === gatherWorker} movements=${woodMovements.length}`
					)

					if ((gather.storage.stock.wood || 0) === 0) {
						consumedSecondWood = true
						break
					}
				}

				expect(consumedSecondWood, timeline.join('\n')).toBe(true)
			} finally {
				console.error = originalError
			}

			expect(errors.join('\n')).not.toContain('Validation failed for lerp')
			expect(errors.join('\n')).not.toContain('walk.npcs')
		} finally {
			await engine.destroy()
		}
	})
})
