import type { SaveState } from 'ssh/game'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

async function flushDeferred(turns: number = 3) {
	for (let i = 0; i < turns; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0))
	}
}

function claimMovementForTest(movement: {
	claimed?: boolean
	claimedBy?: string
	claimedAtMs?: number
}) {
	movement.claimed = true
	movement.claimedBy = 'gather-to-sawmill-regression'
	movement.claimedAtMs = Date.now()
}

function releaseMovementClaimForTest(movement: {
	claimed?: boolean
	claimedBy?: string
	claimedAtMs?: number
}) {
	movement.claimed = false
	delete movement.claimedBy
	delete movement.claimedAtMs
}

describe('Gather to sawmill regression', () => {
	it('keeps exposing a convey job for the second reserved wood after the first wood advances', {
		timeout: 20000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'GatherSawmillDiagnosticHive',
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

			const getMovements = () =>
				Array.from(gather.hive.movingGoods.values())
					.flat()
					.filter((movement: any) => movement.goodType === 'wood')

			const debugTimeline: string[] = []
			const snapshot = (label: string) => {
				const gate = gather.gates[0]
				const movements = getMovements()
				debugTimeline.push(
					[
						label,
						`gatherJob=${gather.getJob()?.job ?? 'none'}`,
						`aGoodMovement=${gather.aGoodMovement?.length ?? 0}`,
						`gatherStock=${JSON.stringify(gather.storage.debugInfo)}`,
						`gateStock=${JSON.stringify(gate?.storage.debugInfo)}`,
						`movements=${JSON.stringify(
							movements.map((movement: any) => ({
								from: movement.from,
								path: movement.path,
								claimed: movement.claimed,
							}))
						)}`,
					].join(' | ')
				)
			}

			snapshot('initial')

			const initialMovements = getMovements()
			expect(initialMovements).toHaveLength(1)
			expect(gather.getJob()?.job, debugTimeline.join('\n')).toBe('convey')

			const firstMovement = initialMovements[0]
			claimMovementForTest(firstMovement)
			firstMovement.allocations.source.fulfill()
			firstMovement.hop()
			firstMovement.place()
			await flushDeferred()

			snapshot('after-first-hop-to-gate')

			expect(gather.getJob()?.job, debugTimeline.join('\n')).toBe('convey')

			claimMovementForTest(firstMovement)
			firstMovement.allocations.source.fulfill()
			firstMovement.hop()
			firstMovement.place()
			releaseMovementClaimForTest(firstMovement)
			firstMovement.finish()
			await flushDeferred()

			snapshot('after-first-finish')

			expect(getMovements().length, debugTimeline.join('\n')).toBeGreaterThan(0)
			expect(gather.getJob()?.job, debugTimeline.join('\n')).toBe('convey')
			expect(gather.aGoodMovement?.length ?? 0, debugTimeline.join('\n')).toBeGreaterThan(0)
		} finally {
			await engine.destroy()
		}
	})

	it('conveys and transforms two starting wood from gatherer into planks without stalling', {
		timeout: 20000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'GatherSawmillHive',
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
			await flushDeferred()

			let reachedGoal = false
			const timeline: string[] = []

			for (let i = 0; i < 80; i++) {
				engine.tick(0.25)
				if (i % 4 === 0) await flushDeferred(1)

				const gatherWood = gather.storage.stock.wood || 0
				const sawmillWood = sawmill.storage.stock.wood || 0
				const sawmillPlanks = sawmill.storage.stock.planks || 0
				const movingGoods = Array.from(gather.hive.movingGoods.values()).flat().length

				timeline.push(
					`tick=${i} gatherWood=${gatherWood} sawmillWood=${sawmillWood} sawmillPlanks=${sawmillPlanks} moving=${movingGoods} gatherJob=${gather.getJob?.(gatherWorker)?.job ?? 'none'} sawmillJob=${sawmill.getJob?.(sawmillWorker)?.job ?? 'none'} gatherAction=${gatherWorker.actionDescription.join('/') || 'none'} sawmillAction=${sawmillWorker.actionDescription.join('/') || 'none'}`
				)

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
})
