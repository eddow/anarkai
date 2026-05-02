import { Commitment } from 'ssh/commitment'
import { NoStorage } from 'ssh/storage/no-storage'
import { SlottedStorage } from 'ssh/storage/slotted-storage'
import { SpecificStorage } from 'ssh/storage/specific-storage'
import type { GoodType } from 'ssh/types/base'
import { beforeEach, describe, expect, it } from 'vitest'

describe.each([
	[
		'SlottedStorage',
		() => new SlottedStorage(10, 5), // 10 slots, max 5 per slot
		{
			canStore: (_storage: SlottedStorage, goods: Record<string, number>) => {
				const totalSlotsNeeded = Object.values(goods).reduce(
					(sum, qty) => sum + Math.ceil(qty / 5),
					0
				)
				return totalSlotsNeeded <= 10
			},
		},
	],
	[
		'SpecificStorage',
		() => new SpecificStorage({ wood: 50, stone: 30, berries: 20 }),
		{
			canStore: (storage: SpecificStorage, goods: Record<string, number>) => {
				return Object.entries(goods).every(
					([goodType, qty]) => storage.hasRoom(goodType as GoodType) >= qty
				)
			},
		},
	],
])('Storage System: %s', (_storageType, createStorage, helpers) => {
	let storage: SlottedStorage | SpecificStorage

	beforeEach(() => {
		storage = createStorage()
	})

	describe('Basic Operations', () => {
		it('should start empty', () => {
			expect(storage.isEmpty).toBe(true)
			expect(storage.stock).toEqual({})
		})

		it('should add goods correctly', () => {
			const added = storage.addGood('wood', 3)
			expect(added).toBe(3)
			expect(storage.stock).toEqual({ wood: 3 })
			expect(storage.isEmpty).toBe(false)
		})

		it('should remove goods correctly', () => {
			storage.addGood('wood', 5)
			const removed = storage.removeGood('wood', 3)
			expect(removed).toBe(3)
			expect(storage.stock).toEqual({ wood: 2 })
		})

		it('should not remove more than available', () => {
			storage.addGood('wood', 3)
			const removed = storage.removeGood('wood', 5)
			expect(removed).toBe(3)
			expect(storage.stock).toEqual({})
			expect(storage.isEmpty).toBe(true)
		})

		it('should handle hasRoom correctly', () => {
			const initialRoom = storage.hasRoom('wood')
			storage.addGood('wood', 3)
			const remainingRoom = storage.hasRoom('wood')
			expect(remainingRoom).toBe(initialRoom - 3)
		})

		it('should track available goods (excluding reserved)', () => {
			storage.addGood('wood', 10)
			expect(storage.available('wood')).toBe(10)

			// Reserve some goods
			const commitment = new Commitment('test')
			const result = storage.reserve({ wood: 3 }, commitment)
			expect(result).toBeUndefined()
			expect(storage.available('wood')).toBe(7)
			expect(storage.stock).toEqual({ wood: 10 }) // Stock includes reserved

			commitment.fulfill()
			expect(storage.available('wood')).toBe(7)
			expect(storage.stock).toEqual({ wood: 7 })
		})

		it('should provide availables getter with unreserved goods only', () => {
			storage.addGood('wood', 10)
			storage.addGood('stone', 5)
			expect(storage.availables).toEqual({ wood: 10, stone: 5 })

			const commitment = new Commitment('test')
			const result = storage.reserve({ wood: 3, stone: 2 }, commitment)
			expect(result).toBeUndefined()
			expect(storage.availables).toEqual({ wood: 7, stone: 3 })
			expect(storage.stock).toEqual({ wood: 10, stone: 5 }) // Stock includes reserved

			commitment.fulfill()
			expect(storage.availables).toEqual({ wood: 7, stone: 3 })
			expect(storage.stock).toEqual({ wood: 7, stone: 3 })
		})
	})

	describe('Allocation System', () => {
		it('should allocate room for goods', () => {
			const commitment = new Commitment('test')
			const result = storage.allocate({ wood: 5 }, commitment)
			expect(result).toBeUndefined()
			expect(storage.allocatedSlots).toBe(true)
			expect(storage.virtualGoodsCount).toBe(5)
		})

		it('should fulfill allocation correctly', () => {
			const commitment = new Commitment('test')
			const result = storage.allocate({ wood: 5 }, commitment)
			expect(result).toBeUndefined()
			expect(storage.available('wood')).toBe(0)

			commitment.fulfill()
			expect(storage.stock).toEqual({ wood: 5 })
			expect(storage.available('wood')).toBe(5)
			expect(storage.allocatedSlots).toBe(false)
			expect(storage.virtualGoodsCount).toBe(0)
		})

		it('should cancel allocation correctly', () => {
			const commitment = new Commitment('test')
			const result = storage.allocate({ wood: 5 }, commitment)
			expect(result).toBeUndefined()
			expect(storage.allocatedSlots).toBe(true)

			commitment.cancel('test.cancel')
			expect(storage.stock).toEqual({})
			expect(storage.available('wood')).toBe(0)
			expect(storage.allocatedSlots).toBe(false)
			expect(storage.virtualGoodsCount).toBe(0)
		})

		it('should handle partial allocation when insufficient room', () => {
			// Fill storage to near capacity
			storage.addGood('wood', storage.hasRoom('wood') - 2)

			// Try to allocate more than available room
			const commitment = new Commitment('test')
			const result = storage.allocate({ wood: 5 }, commitment)
			expect(result).toBeUndefined()

			commitment.fulfill()
			// Should only store what was actually allocated
			expect(storage.available('wood')).toBeGreaterThan(0)
		})

		it('should return error string when no room for allocation', () => {
			// Fill storage completely
			const maxRoom = storage.hasRoom('wood')
			storage.addGood('wood', maxRoom)

			const commitment = new Commitment('test')
			const result = storage.allocate({ wood: 1 }, commitment)
			expect(typeof result).toBe('string')
		})

		it('should not let addGood consume allocated room', () => {
			const initialRoom = storage.hasRoom('wood')
			const commitment = new Commitment('incoming')
			const result = storage.allocate({ wood: 2 }, commitment)
			expect(result).toBeUndefined()

			expect(storage.hasRoom('wood')).toBe(initialRoom - 2)

			const added = storage.addGood('wood', initialRoom)
			expect(added).toBe(initialRoom - 2)

			commitment.fulfill()

			expect(storage.stock.wood).toBe(initialRoom)
			expect(storage.hasRoom('wood')).toBe(0)
		})
	})

	describe('Reservation System', () => {
		beforeEach(() => {
			storage.addGood('wood', 10)
			storage.addGood('stone', 5)
		})

		it('should reserve goods correctly', () => {
			const commitment = new Commitment('test')
			const result = storage.reserve({ wood: 3 }, commitment)
			expect(result).toBeUndefined()
			expect(storage.available('wood')).toBe(7)
			expect(storage.stock).toEqual({ wood: 10, stone: 5 })
			expect(storage.virtualGoodsCount).toBe(3)
		})

		it('should fulfill reservation correctly', () => {
			const commitment = new Commitment('test')
			const result = storage.reserve({ wood: 3 }, commitment)
			expect(result).toBeUndefined()
			expect(storage.available('wood')).toBe(7)
			expect(storage.virtualGoodsCount).toBe(3)

			commitment.fulfill()
			expect(storage.stock).toEqual({ wood: 7, stone: 5 })
			expect(storage.available('wood')).toBe(7)
			expect(storage.virtualGoodsCount).toBe(0)
		})

		it('should cancel reservation correctly', () => {
			const commitment = new Commitment('test')
			const result = storage.reserve({ wood: 3 }, commitment)
			expect(result).toBeUndefined()
			expect(storage.available('wood')).toBe(7)
			expect(storage.virtualGoodsCount).toBe(3)

			commitment.cancel('test.cancel')
			expect(storage.available('wood')).toBe(10)
			expect(storage.stock).toEqual({ wood: 10, stone: 5 })
			expect(storage.virtualGoodsCount).toBe(0)
		})

		it('should handle partial reservation when insufficient goods', () => {
			const commitment = new Commitment('test')
			const result = storage.reserve({ wood: 15 }, commitment) // More than available
			expect(result).toBeUndefined()

			commitment.fulfill()

			// Different behavior for different storage types
			if (storage instanceof SlottedStorage) {
				expect(storage.stock).toEqual({ stone: 5 })
			} else {
				expect(storage.stock).toEqual({ wood: 0, stone: 5 })
			}
		})

		it('should return error string when no goods to reserve', () => {
			storage.removeGood('wood', 10)

			const commitment = new Commitment('test')
			const result = storage.reserve({ wood: 1 }, commitment)
			expect(typeof result).toBe('string')
		})

		it('should not allow double-reservation of same goods', () => {
			const commitment1 = new Commitment('test1')
			const result1 = storage.reserve({ wood: 5 }, commitment1)
			expect(result1).toBeUndefined()
			expect(storage.available('wood')).toBe(5)

			// Should only be able to reserve remaining available
			const commitment2 = new Commitment('test2')
			const result2 = storage.reserve({ wood: 8 }, commitment2) // More than available
			expect(result2).toBeUndefined()

			commitment1.fulfill()
			commitment2.fulfill()

			// Should have removed all wood
			expect(storage.available('wood')).toBe(0)
		})
	})

	describe('Concurrent Operations', () => {
		beforeEach(() => {
			storage.addGood('wood', 20)
			storage.addGood('stone', 15)
		})

		it('should handle multiple allocations simultaneously', () => {
			const commitment1 = new Commitment('test1')
			const result1 = storage.allocate({ wood: 5 }, commitment1)
			expect(result1).toBeUndefined()
			const commitment2 = new Commitment('test2')
			const result2 = storage.allocate({ wood: 3 }, commitment2)
			expect(result2).toBeUndefined()

			expect(storage.allocatedSlots).toBe(true)
			expect(storage.virtualGoodsCount).toBe(8)

			commitment1.fulfill()
			expect(storage.virtualGoodsCount).toBe(3)
			commitment2.fulfill()

			expect(storage.stock).toEqual({ wood: 28, stone: 15 })
			expect(storage.virtualGoodsCount).toBe(0)
		})

		it('should handle allocation and reservation simultaneously', () => {
			const allocCommitment = new Commitment('alloc')
			const result1 = storage.allocate({ wood: 5 }, allocCommitment)
			expect(result1).toBeUndefined()
			const reserveCommitment = new Commitment('reserve')
			const result2 = storage.reserve({ wood: 3 }, reserveCommitment)
			expect(result2).toBeUndefined()
			expect(storage.virtualGoodsCount).toBe(8)

			allocCommitment.fulfill()
			expect(storage.virtualGoodsCount).toBe(3)
			reserveCommitment.fulfill()

			// Should have 20 + 5 - 3 = 22 wood
			expect(storage.stock).toEqual({ wood: 22, stone: 15 })
			expect(storage.virtualGoodsCount).toBe(0)
		})

		it('should maintain consistency during complex operations', () => {
			// Start with some goods
			storage.addGood('wood', 20)
			storage.addGood('stone', 15)

			// Try to allocate some room (may fail for SlottedStorage if insufficient slots)
			const allocCommitment1 = new Commitment('alloc1')
			const allocResult1 = storage.allocate({ wood: 5 }, allocCommitment1)
			if (allocResult1 === undefined) {
				allocCommitment1.fulfill()
			}

			// Reserve some goods
			const resCommitment1 = new Commitment('reserve1')
			storage.reserve({ stone: 3 }, resCommitment1)
			// Add more goods
			storage.addGood('berries', 10)

			// Try to allocate more room
			const allocCommitment2 = new Commitment('alloc2')
			const allocResult2 = storage.allocate({ berries: 5 }, allocCommitment2)
			if (allocResult2 === undefined) {
				allocCommitment2.fulfill()
			}

			// Reserve more goods
			const resCommitment2 = new Commitment('reserve2')
			storage.reserve({ wood: 2 }, resCommitment2)

			// Fulfill all operations
			resCommitment1.fulfill()
			resCommitment2.fulfill()

			// Verify final state - both storage types should be consistent
			expect(storage.stock).toBeDefined()
			expect(storage.stock.wood || 0).toBeGreaterThanOrEqual(0)
			expect(storage.stock.stone || 0).toBeGreaterThanOrEqual(0)
			expect(storage.stock.berries || 0).toBeGreaterThanOrEqual(0)
		})
	})

	describe('Edge Cases', () => {
		it('should handle zero quantities gracefully', () => {
			storage.addGood('wood', 5)
			const removed = storage.removeGood('wood', 0)
			expect(removed).toBe(0)
			expect(storage.stock).toEqual({ wood: 5 })
		})

		it('should handle negative quantities gracefully', () => {
			storage.addGood('wood', 5)
			const removed = storage.removeGood('wood', -3)

			// Different behavior for different storage types
			if (storage instanceof SlottedStorage) {
				expect(removed).toBe(0) // SlottedStorage doesn't allow negative removal
				expect(storage.stock).toEqual({ wood: 5 })
			} else {
				expect(removed).toBe(-3) // SpecificStorage returns negative quantity
				expect(storage.stock).toEqual({ wood: 5 }) // But doesn't actually change stock
			}
		})

		it('should handle invalid allocations gracefully', () => {
			const result = storage.allocate({}, new Commitment('test')) // Empty goods
			expect(result).toBe('Empty goods object provided for allocation')
		})

		it('should handle invalid reservations gracefully', () => {
			const result = storage.reserve({}, new Commitment('test')) // Empty goods
			expect(result).toBe('Empty goods object provided for reservation')
		})

		it('should maintain invariants after failed operations', () => {
			const initialStock = { ...storage.stock }

			// Try operations that should fail (empty goods)
			const result = storage.allocate({}, new Commitment('test'))
			expect(typeof result).toBe('string')

			// State should be unchanged
			expect(storage.stock).toEqual(initialStock)
		})
	})

	describe('canStoreAll', () => {
		it('should correctly determine if all goods can be stored', () => {
			const canStore = helpers.canStore(storage as any, { wood: 5, stone: 3 })
			expect(storage.canStoreAll({ wood: 5, stone: 3 })).toBe(canStore)
		})

		it('should handle empty goods object', () => {
			expect(storage.canStoreAll({})).toBe(true)
		})

		it('should handle zero quantities', () => {
			expect(storage.canStoreAll({ wood: 0, stone: 0 })).toBe(true)
		})
	})

	describe('Rendered Goods', () => {
		it('should render goods correctly', () => {
			storage.addGood('wood', 5)
			const rendered = storage.renderedGoods()
			expect(rendered.slots).toBeDefined()
			expect(Array.isArray(rendered.slots)).toBe(true)
		})
	})

	describe('Defragmentation', () => {
		it('should consolidate slotted goods instead of swapping fragmentation forever', () => {
			if (!(storage instanceof SlottedStorage)) return

			storage.slots.splice(
				0,
				storage.slots.length,
				{ goodType: 'wood', quantity: 2, allocated: 0, reserved: 0 } as any,
				{ goodType: 'wood', quantity: 1, allocated: 0, reserved: 0 } as any,
				...Array(storage.slots.length - 2).fill(undefined)
			)

			expect(storage.fragmented).toBe('wood')

			const takeCommitment = new Commitment('defragment.take')
			const arrangeCommitment = new Commitment('defragment.arrange')
			storage.allocate({ wood: 1 }, takeCommitment)
			storage.reserve({ wood: 1 }, arrangeCommitment)

			takeCommitment.fulfill()
			arrangeCommitment.fulfill()

			expect(storage.stock.wood).toBe(3)
			expect(storage.fragmented).toBeUndefined()
		})
	})
})

describe('SlottedStorage renderedGoods', () => {
	it('pads with empty slots so layout uses total capacity', () => {
		const storage = new SlottedStorage(4, 5)
		storage.addGood('wood', 3)
		const rendered = storage.renderedGoods()
		expect(rendered.slots).toHaveLength(4)
		expect(rendered.assumedMaxSlots).toBe(4)
		expect(rendered.slots.filter((s) => s.goodType === undefined)).toHaveLength(3)
		expect(rendered.slots.find((s) => s.goodType === 'wood')?.present).toBe(3)
	})
})

describe('SlottedStorage slot helpers', () => {
	it('tracks occupied slots, empty slots, and partial room per good', () => {
		const storage = new SlottedStorage(4, 2)

		storage.addGood('wood', 3)
		storage.addGood('stone', 2)

		expect(storage.usedSlots).toBe(3)
		expect(storage.emptySlots).toBe(1)
		expect(storage.occupiedSlots('wood')).toBe(2)
		expect(storage.occupiedSlots('stone')).toBe(1)
		expect(storage.slotUsage()).toEqual({ wood: 2, stone: 1 })
		expect(storage.hasPartialRoomFor('wood')).toBe(true)
		expect(storage.hasPartialRoomFor('stone')).toBe(false)
		expect(storage.hasPartialRoomFor('berries')).toBe(false)
	})
})

describe('NoStorage', () => {
	let storage: NoStorage

	beforeEach(() => {
		storage = new NoStorage()
	})

	it('should always be empty', () => {
		expect(storage.isEmpty).toBe(true)
		expect(storage.stock).toEqual({})
	})

	it('should never have room', () => {
		expect(storage.hasRoom('wood')).toBe(0)
		expect(storage.hasRoom()).toBe(0)
	})

	it('should never add or remove goods', () => {
		expect(storage.addGood('wood', 5)).toBe(0)
		expect(storage.removeGood('wood', 5)).toBe(0)
	})

	it('should never have virtual goods', () => {
		expect(storage.virtualGoodsCount).toBe(0)
	})

	it('should always fail on allocation', () => {
		const result = storage.allocate({ wood: 1 }, new Commitment('test'))
		expect(typeof result).toBe('string')
	})

	it('should always fail on reservation', () => {
		const result = storage.reserve({ wood: 1 }, new Commitment('test'))
		expect(typeof result).toBe('string')
	})

	it('should never be able to store all goods', () => {
		expect(storage.canStoreAll({ wood: 1 })).toBe(false)
		expect(storage.canStoreAll({})).toBe(false)
	})
})
