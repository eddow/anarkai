import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

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

			// Use default scriptsContext which has all scripts loaded
			const context = char.scriptsContext as any

			// Ensure scripts are loaded (it's a getter that triggers loading)
			void context

			context.find.path = (_dest: any) => [targetTile]

			const work = (context as any).work
			if (!work.offload) throw new Error('offload not loaded')

			// Construct Plan
			const plan = {
				type: 'work',
				job: 'offload',
				target: targetTile,
				urgency: 1,
				fatigue: 0,
				looseGood,
				invariant: () => true,
			}

			context.plan.begin(plan)
			const execution = work.offload(plan)
			let result = execution.run(context)
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
				result = execution.run(context)
				loops++
			}

			const finalGoods = game.hex.looseGoods.getGoodsAt(targetTile.position)
			const carriedWood = char.carry.stock.wood ?? 0
			const looseWood = finalGoods.filter((g) => g.goodType === 'wood' && !g.isRemoved).length
			expect(carriedWood + looseWood).toBe(1)
		} finally {
			await engine.destroy()
		}
	})
})
