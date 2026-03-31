import { Hive } from 'ssh/hive/hive'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { toAxialCoord } from 'ssh/utils/position'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine/engine'

describe('Convey hop mechanism', () => {
	it('should track moving good correctly after hop', async () => {
		const engine = new TestEngine({
			boardSize: 6,
			terrainSeed: 1234,
			characterCount: 0,
		})

		// Load scenario with pre-built storage alveoli
		engine.loadScenario({
			generationOptions: {
				boardSize: 6,
				terrainSeed: 1234,
				characterCount: 0,
			},
			tiles: [
				{ coord: [0, 0], alveolus: 'storage', goods: { wood: 10 } },
				{ coord: [2, 0], alveolus: 'storage', goods: {} },
			],
			hives: [
				{
					name: 'TestHive',
					alveoli: [
						{ coord: [0, 0], alveolus: 'storage' },
						{ coord: [2, 0], alveolus: 'storage' },
					],
				},
			],
		} as any)

		await engine.init()

		const game = engine.game
		const board = game.hex

		// Get the pre-built alveoli
		const providerTile = board.getTile({ q: 0, r: 0 })!
		const demanderTile = board.getTile({ q: 2, r: 0 })!

		const provider = providerTile.content as StorageAlveolus
		const demander = demanderTile.content as StorageAlveolus

		// Use the hive factory method
		const hive = Hive.for(providerTile)

		// Create a movement with path: provider -> border -> border -> demander
		const path = [
			{ q: 0.5, r: 0 }, // border between provider and middle
			{ q: 1.5, r: 0 }, // border between middle and demander
			{ q: 2, r: 0 }, // demander tile
		]

		// Create movement
		const movementCreated = hive.createMovement('wood', provider, demander)
		expect(movementCreated).toBe(true)

		// Check initial state
		expect(hive.movingGoods.size).toBe(1)
		const initialCoord = toAxialCoord(providerTile.position)!
		const initialMovements = hive.movingGoods.get(initialCoord)!
		expect(initialMovements).toHaveLength(1)

		const movingGood = initialMovements[0]
		expect(movingGood.path).toEqual(path)
		expect(movingGood.from).toEqual(initialCoord)

		// Perform first hop
		const firstHop = movingGood.hop()!
		expect(firstHop).toEqual({ q: 0.5, r: 0 })

		// Verify the moving good is now tracked at the new position
		expect(hive.movingGoods.get(initialCoord)).toBeUndefined()
		const firstHopMovements = hive.movingGoods.get(firstHop)!
		expect(firstHopMovements).toHaveLength(1)
		expect(firstHopMovements[0]).toBe(movingGood)
		expect(movingGood.from).toEqual(firstHop)

		// Perform second hop
		const secondHop = movingGood.hop()!
		expect(secondHop).toEqual({ q: 1.5, r: 0 })

		// Verify the moving good is now tracked at the second position
		expect(hive.movingGoods.get(firstHop)).toBeUndefined()
		const secondHopMovements = hive.movingGoods.get(secondHop)!
		expect(secondHopMovements).toHaveLength(1)
		expect(secondHopMovements[0]).toBe(movingGood)
		expect(movingGood.from).toEqual(secondHop)

		// Perform final hop
		const finalHop = movingGood.hop()!
		expect(finalHop).toEqual({ q: 2, r: 0 })

		// Verify the moving good is now tracked at the final position
		expect(hive.movingGoods.get(secondHop)).toBeUndefined()
		const finalHopMovements = hive.movingGoods.get(finalHop)!
		expect(finalHopMovements).toHaveLength(1)
		expect(finalHopMovements[0]).toBe(movingGood)
		expect(movingGood.from).toEqual(finalHop)

		// Finish the movement
		movingGood.finish()

		// Verify the moving good is removed from tracking
		expect(hive.movingGoods.size).toBe(0)

		await engine.destroy()
	})
})
