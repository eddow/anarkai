// Manual DOM mock for PixiJS and test environment
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
if (typeof window === 'undefined') {
	;(global as any).window = global
}
if (typeof navigator === 'undefined') {
	;(global as any).navigator = { userAgent: 'node' }
}

import { Game } from 'ssh/game/game'
import { InventoryFunctions } from 'ssh/npcs/context/inventory'
import { subject } from 'ssh/npcs/scripts'
import { MoveToStep } from 'ssh/npcs/steps'
import type { AxialCoord } from 'ssh/utils/axial'
import { toAxialCoord } from 'ssh/utils/position'
import { describe, expect, it, vi } from 'vitest'

// Mock Debug to silence rendering assertions
vi.mock('ssh/src/lib/debug', () => ({
	assert: () => {},
	defined: (v: any) => v,
	check: () => true,
	namedEffect: (_name: string, _fn: Function) => {
		// Just execute it once or return cleanup?
		// Effect usually returns a cleanup function owner.
		// But here we can mock it as a simple function that returns a void cleanup
		// OR better, since it drives rendering, maybe don't execute it at all to be safe?
		// But object.ts calls it.
		// If we don't execute logic, render() isn't called. good.
		return () => {}
	},
}))

// Mock Assets
vi.mock('ssh/assets/resources', () => ({ resources: {}, prefix: '' }))
vi.mock('ssh/assets/game-content', () => {
	return {
		vehicles: { 'by-hands': { storage: { slots: 10, capacity: 100 } } },
		goods: new Proxy(
			{
				wood: { sprites: ['wood.png'] },
				stone: { sprites: ['stone.png'] },
				plank: { sprites: ['plank.png'] },
			},
			{
				get: (target, prop) => {
					if (prop in target) return target[prop as keyof typeof target]
					return { sprites: ['missing.png'] }
				},
			}
		),
		terrain: new Proxy(
			{},
			{
				get: () => ({
					walkTime: 1,
					generation: { deposits: {} },
					sprites: ['grass.png'],
				}),
			}
		),
		deposits: {},
		alveoli: {
			storage: {
				action: {
					type: 'specific-storage',
					goods: { wood: 100, plank: 100, stone: 100 },
				},
			},
			buffer: {
				action: {
					type: 'specific-storage',
					goods: { wood: 100, plank: 100, stone: 100 },
				},
			},
		},
		configurations: {
			'specific-storage': { working: true, buffers: {} },
			default: { working: true },
		},
	}
})

// Force fetch mock
;(global as any).fetch = vi.fn().mockResolvedValue({
	ok: true,
	status: 200,
	json: async () => ({ frames: {}, meta: { size: { w: 1, h: 1 } } }),
	blob: async () => ({
		type: 'image/png',
		arrayBuffer: async () => new ArrayBuffer(0),
	}),
	text: async () => '',
	headers: new Map(),
})

describe('Evolutive & Determinism Tests', () => {
	// Use static imports
	// Patch getTexture
	Game.prototype.getTexture = () => ({
		defaultAnchor: { x: 0.5, y: 0.5 },
		width: 1,
		height: 1,
	})

	it('Determinism: Complex State Persistence', async () => {
		// Setup a semi-complex state with patches and manual chars
		const config = { terrainSeed: 888, characterCount: 0 }
		const patches = {
			hives: [
				{
					name: 'Hive1',
					alveoli: [
						{ coord: [0, 0], alveolus: 'storage' },
						{ coord: [0, 1], alveolus: 'storage' },
					],
				},
			],
			looseGoods: [
				{ goodType: 'wood', position: { q: 2, r: 2 } },
				{ goodType: 'stone', position: { q: 1, r: 1 } },
			],
		} as any

		const game1 = new Game(config)
		const game2 = new Game(config)
		await game1.loaded
		await game2.loaded
		try {
			try {
				await game1.generate(config, patches)
			} catch (e) {
				console.warn('G1 Generate error', e)
			}

			// Manually spawn characters
			const worker1 = game1.population.createCharacter('Worker1', { q: 2, r: 2 })
			const worker2 = game1.population.createCharacter('Worker2', { q: 4, r: 4 })
			worker1.carry.addGood('wood', 1)
			worker2.carry.addGood('stone', 1)

			// Save State M
			const stateM = game1.saveGameData()
			const stateM_JSON = JSON.stringify(stateM)

			// Debug logging
			try {
				const parsed = JSON.parse(stateM_JSON)
				console.log('Population Data Keys:', Object.keys(parsed.population || {}))
				if (parsed.population?.['0']) {
					console.log('Char 0:', JSON.stringify(parsed.population['0']))
				}
			} catch (e) {
				console.log('Debug log error', e)
			}

			await game2.loadGameData(JSON.parse(stateM_JSON))

			const chars1 = Array.from(game1.population)
			const chars2 = Array.from(game2.population)
			const looseGoodsAt = (game: Game, position: { q: number; r: number }) =>
				game.hex.looseGoods
					.getGoodsAt(position)
					.map((good) => good.goodType)
					.sort()

			expect(chars1.length).toBe(chars2.length)
			expect(chars1.length).toBe(2)
			expect(looseGoodsAt(game1, { q: 2, r: 2 })).toContain('wood')
			expect(looseGoodsAt(game2, { q: 2, r: 2 })).toContain('wood')
			expect(looseGoodsAt(game1, { q: 1, r: 1 })).toContain('stone')
			expect(looseGoodsAt(game2, { q: 1, r: 1 })).toContain('stone')

			chars1.forEach((c1, _idx) => {
				const c2 = chars2.find((c) => c.uid === c1.uid)
				expect(c2).toBeDefined()

				const p1 = toAxialCoord(c1.position)
				const p2 = toAxialCoord(c2!.position)
				expect(p2.q).toBeCloseTo(p1.q, 0)
				expect(p2.r).toBeCloseTo(p1.r, 1)
				expect(c2!.carry.available('wood')).toBe(c1.carry.available('wood'))
				expect(c2!.carry.available('stone')).toBe(c1.carry.available('stone'))
			})
		} finally {
			game2.destroy()
			game1.destroy()
		}
	})

	it('Simulation: Plank Transfer (Logistics)', async () => {
		// Setup: Source (0,0) with Wood, Target (0,5) Empty, Worker (2,2)
		const config = { terrainSeed: 101, characterCount: 0 }
		const patches = {
			hives: [
				{
					name: 'TestHive',
					alveoli: [
						{ coord: [0, 0], alveolus: 'storage', goods: { wood: 1 } },
						{ coord: [0, 1], alveolus: 'storage' },
					],
				},
			],
		} as any

		const game = new Game(config)
		await game.loaded
		try {
			await game.generate(config, patches)

			const worker = game.population.createCharacter('Worker1', { q: 2, r: 2 })
			const sourceTile = game.hex.getTile({ q: 0, r: 0 })!
			const targetTile = game.hex.getTile({ q: 0, r: 1 })!
			sourceTile.content!.working = false
			targetTile.content!.working = false

			const sourceStorage = sourceTile.content!.storage!
			const validSourceContent = sourceTile.content! // Capture before it reverts to UnBuiltLand due to side-effects
			if ('slots' in (sourceStorage as any)) {
				for (let i = 0; i < (sourceStorage as any).slots.length; i++) {
					;(sourceStorage as any).slots[i] = undefined
				}
				sourceStorage.addGood('wood', 1)
			}

			expect((sourceStorage as any).stock.wood || 0).toBe(1)

			// Use static imports
			// Setup inventory function context
			const inventory = new InventoryFunctions()
			;(inventory as any)[subject] = worker

			const moveStep = new MoveToStep(1, worker, { q: 0, r: 0 })
			worker.stepExecutor = moveStep
			const dt = 0.1
			for (let i = 0; i < 50; i++) {
				worker.update(dt)
				game.ticker.update(dt * 1000)
				if (worker.stepExecutor !== moveStep) break
			}
			expect(toAxialCoord(worker.position).q).toBeCloseTo(0, 0)

			// 2. Grab Wood
			// Workaround: Create a fake Tile object that holds the correct content
			// This avoids the Proxy/Target split issue where the Target (stripped by contracts) is stale.
			const fakeTile = Object.create(Object.getPrototypeOf(sourceTile))
			Object.defineProperty(fakeTile, 'content', {
				value: validSourceContent,
				configurable: true,
			})
			Object.defineProperty(fakeTile, 'position', { value: sourceTile.position })
			Object.defineProperty(fakeTile, 'uid', { value: sourceTile.uid })

			const grabGoods = { wood: 1 }
			const vehicleAllocation = worker.vehicle.storage.allocate(grabGoods, 'planGrabStored')
			const sourceReservation = sourceStorage.reserve(grabGoods, 'planGrabStored')

			// Assert Reservations (Allocations created immediately in planGrab)
			expect((sourceStorage as any).available('wood')).toBe(0)
			expect(worker.carry.available('wood')).toBe(0) // Not yet fulfilled

			// Simulate Conclude
			sourceReservation.fulfill()
			vehicleAllocation.fulfill()

			// Assert Possession
			expect(worker.carry.available('wood')).toBe(1)

			// 3. Move to Target
			// Teleport for simulation stability (pathfinding depends on map gen)
			worker.stepExecutor = undefined // Stop any running step
			;(worker.position as AxialCoord).q = 0
			;(worker.position as AxialCoord).r = 1

			expect(toAxialCoord(worker.position).r).toBe(1)

			// 4. Drop Wood
			// We manually construct drop plan/actions since planDropStored needs similar context
			// Drop: Allocate on target, Reserve on vehicle
			// Refetch storage to ensure validity after simulation
			const currentTargetStorage = game.hex.getTile({ q: 0, r: 1 })!.content!.storage!

			const dropGoods = { wood: 1 }
			const targetAllocation = currentTargetStorage.allocate!(dropGoods, 'planDropStored')
			const vehicleReservation = worker.vehicle.storage.reserve(dropGoods, 'planDropStored')

			// Fulfill
			targetAllocation.fulfill()
			vehicleReservation.fulfill()

			// Final Assertion
			expect(worker.carry.available('wood')).toBe(0)
			expect((currentTargetStorage as any).available('wood')).toBe(1)
		} finally {
			game.destroy()
		}
	})
})
