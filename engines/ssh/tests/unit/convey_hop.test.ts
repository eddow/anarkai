import type { Hive } from 'ssh/hive/hive'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { toAxialCoord } from 'ssh/utils/position'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine/engine'

describe('Convey hop mechanism', () => {
	it('should track moving good correctly after hop', { timeout: 20000 }, async () => {
		const engine = new TestEngine({
			boardSize: 6,
			terrainSeed: 1234,
			characterCount: 0,
		})

		await engine.init()
		try {
			// Load scenario with pre-built storage alveoli
			engine.loadScenario({
				generationOptions: {
					boardSize: 6,
					terrainSeed: 1234,
					characterCount: 0,
				},
				hives: [
					{
						name: 'TestHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: { wood: 10 } },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
			} as any)

			const game = engine.game
			const board = game.hex

			// Get the pre-built alveoli
			const providerTile = board.getTile({ q: 0, r: 0 })!
			const demanderTile = board.getTile({ q: 1, r: 0 })!

			const provider = providerTile.content as StorageAlveolus
			const demander = demanderTile.content as StorageAlveolus

			const hive = provider.hive as Hive

			// Create movement
			const movementCreated = hive.createMovement('wood', provider, demander)
			expect(movementCreated).toBe(true)

			// Check initial state
			expect(hive.movingGoods.size).toBe(1)
			const initialCoord = toAxialCoord(providerTile.position)!
			const initialMovements = hive.movingGoods.get(initialCoord)!
			expect(initialMovements).toHaveLength(1)

			const movingGood = initialMovements[0]
			expect(movingGood.path.map(({ q, r }) => ({ q, r }))).toEqual([
				{ q: 0.5, r: 0 },
				{ q: 1, r: 0 },
			])
			expect(movingGood.from).toEqual(initialCoord)

			// Perform first hop
			const firstHop = movingGood.hop()!
			expect(firstHop).toMatchObject({ q: 0.5, r: 0 })

			// A hop removes the movement from the previous coordinate until it is placed again.
			expect(hive.movingGoods.get(initialCoord)).toBeUndefined()
			expect(hive.movingGoods.get(firstHop)).toBeUndefined()
			expect(movingGood.from).toEqual(firstHop)
			movingGood.place()
			const firstHopMovements = hive.movingGoods.get(firstHop)!
			expect(firstHopMovements).toHaveLength(1)
			expect(firstHopMovements[0]).toBe(movingGood)

			// Perform final hop to the destination tile
			const finalHop = movingGood.hop()!
			expect(finalHop).toMatchObject({ q: 1, r: 0 })

			expect(hive.movingGoods.get(firstHop)).toBeUndefined()
			movingGood.place()
			const finalHopMovements = hive.movingGoods.get(finalHop)!
			expect(finalHopMovements).toHaveLength(1)
			expect(finalHopMovements[0]).toBe(movingGood)
			expect(movingGood.from).toEqual(finalHop)

			// Finish the movement
			movingGood.finish()

			// Verify the moving good is removed from tracking
			expect(hive.movingGoods.size).toBe(0)
		} finally {
			await engine.destroy()
		}
	})
})
