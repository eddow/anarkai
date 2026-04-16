import type { Hive } from 'ssh/hive/hive'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { toAxialCoord } from 'ssh/utils/position'
import { describe, expect, it, vi } from 'vitest'
import { TestEngine } from '../test-engine/engine'

vi.mock('npc-script', () => {
	class NpcScript {
		execute(_ctx: unknown) {
			return { type: 'return', value: {} }
		}
	}
	class ScriptExecutor {}
	return {
		jsIsaTypes: {},
		jsOperators: {
			'==': (left: unknown, right: unknown) => left === right,
			'-': (left: number, right: number) => left - right,
			'+': (left: number, right: number) => left + right,
			'*': (left: number, right: number) => left * right,
			'/': (left: number, right: number) => left / right,
		},
		NpcScript,
		ScriptExecutor,
		ExecutionError: class extends Error {},
		FunctionDefinition: class {},
	}
})

describe('MovingGood.claimed prevents double pickup', () => {
	it('aGoodMovement skips a movement that is already claimed', { timeout: 15000 }, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})

		await engine.init()
		try {
			engine.loadScenario({
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				hives: [
					{
						name: 'ClaimHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: { wood: 3 } },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
			} as any)

			const board = engine.game.hex
			const provider = board.getTile({ q: 0, r: 0 })!.content as StorageAlveolus
			const demander = board.getTile({ q: 1, r: 0 })!.content as StorageAlveolus
			const hive = provider.hive as Hive

			// Create a movement
			expect(hive.createMovement('wood', provider, demander)).toBe(true)

			const provCoord = toAxialCoord(provider.tile.position)!
			const mgs = hive.movingGoods.get(provCoord)!
			expect(mgs).toHaveLength(1)
			const mg = mgs[0]

			// Before claiming, aGoodMovement should see it
			expect(mg.claimed).toBe(false)
			expect(provider.aGoodMovement).toBeTruthy()
			expect(provider.aGoodMovement!.length).toBe(1)

			// Claim the movement
			mg.claimed = true

			// After claiming, aGoodMovement should NOT see it
			expect(provider.aGoodMovement).toBeUndefined()

			// Unclaim → visible again
			mg.claimed = false
			expect(provider.aGoodMovement).toBeTruthy()

			// Clean up
			mg.finish()
		} finally {
			await engine.destroy()
		}
	})

	it('movement selections expose the canonical movement explicitly', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})

		await engine.init()
		try {
			engine.loadScenario({
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				hives: [
					{
						name: 'WriteThroughHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: { wood: 3 } },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
			} as any)

			const board = engine.game.hex
			const provider = board.getTile({ q: 0, r: 0 })!.content as StorageAlveolus
			const demander = board.getTile({ q: 1, r: 0 })!.content as StorageAlveolus
			const hive = provider.hive as Hive

			expect(hive.createMovement('wood', provider, demander)).toBe(true)

			const provCoord = toAxialCoord(provider.tile.position)!
			const realMg = hive.movingGoods.get(provCoord)![0]

			// Get the selection from aGoodMovement
			const selection = provider.aGoodMovement![0]
			expect(realMg.claimed).toBe(false)
			expect(selection.movement).toBe(realMg)
			expect(selection.movement.ref).toBe(realMg.ref)
			expect(selection.fromSnapshot).toEqual(realMg.from)

			// Claim via the canonical movement
			selection.movement.claimed = true
			expect(realMg.claimed).toBe(true)

			// aGoodMovement should now return undefined (the real object is claimed)
			expect(provider.aGoodMovement).toBeUndefined()

			// Unclaim via the canonical movement
			selection.movement.claimed = false
			expect(realMg.claimed).toBe(false)
			expect(provider.aGoodMovement).toBeTruthy()

			realMg.finish()
		} finally {
			await engine.destroy()
		}
	})

	it('claimed is initialized to false on new movements', { timeout: 15000 }, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})

		await engine.init()
		try {
			engine.loadScenario({
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				hives: [
					{
						name: 'InitHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: { wood: 2 } },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
			} as any)

			const board = engine.game.hex
			const provider = board.getTile({ q: 0, r: 0 })!.content as StorageAlveolus
			const demander = board.getTile({ q: 1, r: 0 })!.content as StorageAlveolus
			const hive = provider.hive as Hive

			expect(hive.createMovement('wood', provider, demander)).toBe(true)

			const provCoord = toAxialCoord(provider.tile.position)!
			const mg = hive.movingGoods.get(provCoord)![0]
			expect(mg.claimed).toBe(false)

			mg.finish()
		} finally {
			await engine.destroy()
		}
	})

	it('claimed terminal-hop movements are tolerated while the worker finishes the handoff', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})

		await engine.init()
		try {
			engine.loadScenario({
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				hives: [
					{
						name: 'TerminalHopHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: { wood: 2 } },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
			} as any)

			const board = engine.game.hex
			const provider = board.getTile({ q: 0, r: 0 })!.content as StorageAlveolus
			const demander = board.getTile({ q: 1, r: 0 })!.content as StorageAlveolus
			const hive = provider.hive as Hive

			expect(hive.createMovement('wood', provider, demander)).toBe(true)

			const provCoord = toAxialCoord(provider.tile.position)!
			const mg = hive.movingGoods.get(provCoord)![0]

			mg.claimed = true
			mg.hop()
			mg.hop()

			expect(mg.path).toHaveLength(0)
			expect(
				hive.validateMovementInvariant(mg, {
					requireTracked: false,
					allowClaimedSourceGap: true,
					allowClaimedTerminalPath: true,
				})
			).toBeUndefined()
			expect(provider.aGoodMovement).toBeUndefined()

			mg.claimed = false
			mg.finish()
		} finally {
			await engine.destroy()
		}
	})

	it('incomingGoods only reflects live movement tokens, not stray border allocations', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})

		await engine.init()
		try {
			engine.loadScenario({
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				hives: [
					{
						name: 'IncomingMovementHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: { wood: 1 } },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
			} as any)

			const board = engine.game.hex
			const provider = board.getTile({ q: 0, r: 0 })!.content as StorageAlveolus
			const demander = board.getTile({ q: 1, r: 0 })!.content as StorageAlveolus
			const hive = provider.hive as Hive

			expect(demander.incomingGoods).toBe(false)

			const borderGate = provider.gates.find(
				(gate) => gate.alveolusA === demander || gate.alveolusB === demander
			)
			expect(borderGate).toBeDefined()
			if (!borderGate) throw new Error('Expected border gate between provider and demander')

			const ghostAllocation = borderGate.storage.allocate({ wood: 1 }, { type: 'test.ghost' })
			expect(borderGate.storage.allocatedSlots).toBe(true)
			expect(demander.incomingGoods).toBe(false)

			expect(hive.createMovement('wood', provider, demander)).toBe(true)
			expect(demander.incomingGoods).toBe(false)

			const provCoord = toAxialCoord(provider.tile.position)!
			const movement = hive.movingGoods.get(provCoord)?.[0]
			expect(movement).toBeDefined()
			movement!.claimed = true
			movement?.allocations.source.fulfill()
			movement?.hop()
			movement?.place()
			const hopAlloc = borderGate.storage.allocate({ wood: 1 }, { type: 'test.hop' })
			hopAlloc.fulfill()
			movement!.allocations.source = borderGate.storage.reserve(
				{ wood: 1 },
				{ type: 'test.hop.reserve' }
			)
			movement!.claimed = false
			expect(demander.incomingGoods).toBe(true)
			movement?.abort()
			ghostAllocation.cancel()
		} finally {
			await engine.destroy()
		}
	})
})
