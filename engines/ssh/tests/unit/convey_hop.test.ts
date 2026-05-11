import type { Hive } from 'ssh/hive/hive'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { WorkFunctions } from 'ssh/npcs/context/work'
import { subject } from 'ssh/npcs/scripts'
import { DurationStep, MultiMoveStep } from 'ssh/npcs/steps'
import { toAxialCoord } from 'ssh/utils/position'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine/engine'

describe('Convey hop mechanism', () => {
	it('should track moving good correctly after hop', { timeout: 20000 }, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})

		await engine.init()
		try {
			// Load scenario with pre-built storage alveoli
			engine.loadScenario({
				generationOptions: {
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

			movingGood.claimed = true
			movingGood.claimedBy = 'test-worker'
			movingGood.claimedAtMs = Date.now()

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

			// Release claim and finish the movement
			movingGood.claimed = false
			delete movingGood.claimedBy
			delete movingGood.claimedAtMs
			movingGood.finish()

			// Verify the moving good is removed from tracking
			expect(hive.movingGoods.size).toBe(0)
		} finally {
			await engine.destroy()
		}
	})

	it('does not move source goods to the border before the carrier step fulfills', async () => {
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
						name: 'TestHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: { wood: 10 } },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
			} as any)

			const game = engine.game
			const providerTile = game.hex.getTile({ q: 0, r: 0 })!
			const demanderTile = game.hex.getTile({ q: 1, r: 0 })!
			const provider = providerTile.content as StorageAlveolus
			const demander = demanderTile.content as StorageAlveolus
			const hive = provider.hive as Hive
			expect(hive.createMovement('wood', provider, demander)).toBe(true)

			const movement = hive.movingGoods.get(toAxialCoord(providerTile.position)!)![0]!
			const firstHop = movement.prepareHop()
			const borderStorage = hive.storageAt(firstHop)!
			const carrier = game.population.createCharacter('Carrier', providerTile.position)
			carrier.assignedAlveolus = provider
			provider.assignedWorker = carrier
			const work = new WorkFunctions()
			Object.assign(work, { [subject]: carrier })

			const step = work.conveyStep()
			expect(step).toBeInstanceOf(MultiMoveStep)
			expect(movement.from).toEqual(toAxialCoord(providerTile.position))
			expect(hive.movingGoods.get(firstHop)).toBeUndefined()
			expect(borderStorage.stock.wood ?? 0).toBe(0)
			expect(provider.storage.stock.wood ?? 0).toBe(10)

			step!.tick(0)
			step!.tick((step as MultiMoveStep).duration)
			expect(movement.from).toEqual(firstHop)
			expect(hive.movingGoods.get(firstHop)?.[0]).toBe(movement)
			expect(borderStorage.stock.wood ?? 0).toBe(1)
			expect(borderStorage.available('wood')).toBe(0)
			expect(provider.storage.stock.wood ?? 0).toBe(9)
		} finally {
			await engine.destroy()
		}
	})

	it('cancels the created convey step when hop storage allocation is refused', async () => {
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
						name: 'TestHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: { wood: 10 } },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
			} as any)

			const game = engine.game
			const providerTile = game.hex.getTile({ q: 0, r: 0 })!
			const demanderTile = game.hex.getTile({ q: 1, r: 0 })!
			const provider = providerTile.content as StorageAlveolus
			const demander = demanderTile.content as StorageAlveolus
			const hive = provider.hive as Hive
			expect(hive.createMovement('wood', provider, demander)).toBe(true)

			const movement = hive.movingGoods.get(toAxialCoord(providerTile.position)!)![0]!
			const firstHop = movement.prepareHop()
			const borderStorage = hive.storageAt(firstHop)!
			const originalAllocate = borderStorage.allocate.bind(borderStorage)
			let allocationAttempts = 0
			borderStorage.allocate = ((..._args: Parameters<typeof borderStorage.allocate>) => {
				allocationAttempts++
				return 'forced hop allocation refusal'
			}) as typeof borderStorage.allocate

			try {
				const carrier = game.population.createCharacter('Carrier', providerTile.position)
				carrier.assignedAlveolus = provider
				provider.assignedWorker = carrier
				const work = new WorkFunctions()
				Object.assign(work, { [subject]: carrier })

				const step = work.conveyStep()
				expect(step).toBeInstanceOf(DurationStep)
				expect((step as DurationStep).description).toBe('waitForIncomingGoods')
				expect(allocationAttempts).toBe(1)
				expect(movement._state).toBe('aborted')
				expect(hive.getCanonicalMovement(movement)).toBeUndefined()
				expect(provider.storage.stock.wood ?? 0).toBe(10)
				expect(borderStorage.stock.wood ?? 0).toBe(0)
			} finally {
				borderStorage.allocate = originalAllocate
			}
		} finally {
			await engine.destroy()
		}
	})
})
