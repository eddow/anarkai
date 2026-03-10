import { Game } from 'ssh/game'
import { describe, expect, it, vi } from 'vitest'

// Mock environment
if (typeof document === 'undefined') {
	;(global as any).document = {
		createElement: () => ({
			getContext: () => ({
				getParameter: () => 0,
				getExtension: () => ({}),
			}),
			addEventListener: () => {},
		}),
	}
	;(global as any).document.baseURI = 'http://localhost/'
}
if (typeof window === 'undefined') (global as any).window = global
if (typeof location === 'undefined')
	(global as any).location = {
		href: 'http://localhost/',
		protocol: 'http:',
		host: 'localhost',
		hostname: 'localhost',
	}
if (typeof navigator === 'undefined') (global as any).navigator = { userAgent: 'node' }
if (typeof requestAnimationFrame === 'undefined')
	(global as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 16)

// Mock assets/resources
vi.mock('ssh/assets/resources', () => ({ resources: {}, prefix: '' }))
vi.mock('ssh/assets/game-content', () => ({
	vehicles: { 'by-hands': { storage: { slots: 10, capacity: 100 } } },
	goods: { wood: {}, stone: {}, food: { feedingValue: 1 }, mushrooms: {} },
	terrain: new Proxy({}, { get: () => ({ walkTime: 1, generation: { deposits: {} } }) }),
	deposits: { tree: { generation: { frequency: 0.1 }, maxAmount: 100 } },
	alveoli: { tree_chopper: { action: { deposit: 'tree' } } },
	configurations: {
		'specific-storage': { working: true, buffers: {} },
		default: { working: true },
	},
}))

describe('Offload Silent Cancellation Reproduction', () => {
	it('Reproduction: Offload work cancels silently', async () => {
		const game = new Game({
			boardSize: 12,
			terrainSeed: 1234,
			characterCount: 0,
		})
		await game.loaded

		const char = game.population.createCharacter('Worker', { q: 2, r: 2 })

		// Setup target tile for offloading
		const targetTile = game.hex.getTile({ q: 3, r: 2 })
		if (!targetTile) throw new Error('Target tile not found')

		// Add loose goods to the target tile
		game.hex.looseGoods.add(targetTile, 'wood', {
			position: targetTile.position,
		})

		const goodsAtTile = game.hex.looseGoods.getGoodsAt(targetTile.position)
		expect(goodsAtTile.some((g) => g.goodType === 'wood')).toBe(true)

		// Use default scriptsContext which has all scripts loaded
		const context = char.scriptsContext as any

		// Ensure scripts are loaded (it's a getter that triggers loading)
		void context

		// Mock find.path to return a valid path and avoid test environment crash
		context.find.path = vi.fn().mockImplementation((dest) => [dest])

		const work = (context as any).work
		if (!work.offload) throw new Error('offload not loaded')

		// Construct Plan
		const plan = {
			type: 'work',
			job: 'offload',
			target: targetTile,
			urgency: 1,
			fatigue: 0,
			invariant: () => true,
		}

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
		expect(char.carry.stock.wood ?? 0).toBe(0)
		expect(finalGoods.some((g) => g.goodType === 'wood')).toBe(true)
		expect(finalGoods.some((g) => g.goodType === 'mushrooms')).toBe(true)
	})
})
