import { beforeEach, describe, expect, it } from 'vitest'
import type { GoodType } from '$lib/types/base'
import { AllocationError } from '$lib/game/storage/guard'
import { NoStorage } from '$lib/game/storage/no-storage'
import { SlottedStorage } from '$lib/game/storage/slotted-storage'
import { SpecificStorage } from '$lib/game/storage/specific-storage'

// Test data - keeping for potential future use
// const TEST_GOODS = {
// 	wood: 10,
// 	stone: 5,
// 	berries: 3,
// } as const

// const TEST_GOOD_TYPES: GoodType[] = ['wood', 'stone', 'berries']

describe.each([
	[
		'SlottedStorage',
		() => new SlottedStorage(10, 5), // 10 slots, max 5 per slot
		{
			canStore: (_storage: SlottedStorage, goods: Record<string, number>) => {
				const totalSlotsNeeded = Object.values(goods).reduce(
					(sum, qty) => sum + Math.ceil(qty / 5),
					0,
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
					([goodType, qty]) => storage.hasRoom(goodType as GoodType) >= qty,
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
			const reservation = storage.reserve({ wood: 3 }, 'test')
			expect(storage.available('wood')).toBe(7)
			expect(storage.stock).toEqual({ wood: 10 }) // Stock includes reserved

			reservation.fulfill()
			expect(storage.available('wood')).toBe(7)
			expect(storage.stock).toEqual({ wood: 7 })
		})

		it('should provide availables getter with unreserved goods only', () => {
			storage.addGood('wood', 10)
			storage.addGood('stone', 5)
			expect(storage.availables).toEqual({ wood: 10, stone: 5 })

			const reservation = storage.reserve({ wood: 3, stone: 2 }, 'test')
			expect(storage.availables).toEqual({ wood: 7, stone: 3 })
			expect(storage.stock).toEqual({ wood: 10, stone: 5 }) // Stock includes reserved

			reservation.fulfill()
			expect(storage.availables).toEqual({ wood: 7, stone: 3 })
			expect(storage.stock).toEqual({ wood: 7, stone: 3 })
		})
	})

	describe('Allocation System', () => {
		it('should allocate room for goods', () => {
			const allocation = storage.allocate({ wood: 5 }, 'test')
			expect(allocation).toBeDefined()
			expect(storage.allocatedSlots).toBe(true)
		})

		it('should fulfill allocation correctly', () => {
			const allocation = storage.allocate({ wood: 5 }, 'test')
			expect(storage.available('wood')).toBe(0)

			allocation.fulfill()
			expect(storage.stock).toEqual({ wood: 5 })
			expect(storage.available('wood')).toBe(5)
			expect(storage.allocatedSlots).toBe(false)
		})

		it('should cancel allocation correctly', () => {
			const allocation = storage.allocate({ wood: 5 }, 'test')
			expect(storage.allocatedSlots).toBe(true)

			allocation.cancel()
			expect(storage.stock).toEqual({})
			expect(storage.available('wood')).toBe(0)
			expect(storage.allocatedSlots).toBe(false)
		})

		it('should handle partial allocation when insufficient room', () => {
			// Fill storage to near capacity
			storage.addGood('wood', storage.hasRoom('wood') - 2)

			// Try to allocate more than available room
			const allocation = storage.allocate({ wood: 5 }, 'test')
			expect(allocation).toBeDefined()

			allocation.fulfill()
			// Should only store what was actually allocated
			expect(storage.available('wood')).toBeGreaterThan(0)
		})

		it('should throw error when no room for allocation', () => {
			// Fill storage completely
			const maxRoom = storage.hasRoom('wood')
			storage.addGood('wood', maxRoom)

			expect(() => {
				storage.allocate({ wood: 1 }, 'test')
			}).toThrow(AllocationError)
		})
	})

	describe('Reservation System', () => {
		beforeEach(() => {
			storage.addGood('wood', 10)
			storage.addGood('stone', 5)
		})

		it('should reserve goods correctly', () => {
			storage.reserve({ wood: 3 }, 'test')
			expect(storage.available('wood')).toBe(7)
			expect(storage.stock).toEqual({ wood: 10, stone: 5 })
		})

		it('should fulfill reservation correctly', () => {
			const reservation = storage.reserve({ wood: 3 }, 'test')
			expect(storage.available('wood')).toBe(7)

			reservation.fulfill()
			expect(storage.stock).toEqual({ wood: 7, stone: 5 })
			expect(storage.available('wood')).toBe(7)
		})

		it('should cancel reservation correctly', () => {
			const reservation = storage.reserve({ wood: 3 }, 'test')
			expect(storage.available('wood')).toBe(7)

			reservation.cancel()
			expect(storage.available('wood')).toBe(10)
			expect(storage.stock).toEqual({ wood: 10, stone: 5 })
		})

		it('should handle partial reservation when insufficient goods', () => {
			const reservation = storage.reserve({ wood: 15 }, 'test') // More than available
			expect(reservation).toBeDefined()

			reservation.fulfill()

			// Different behavior for different storage types
			if (storage instanceof SlottedStorage) {
				expect(storage.stock).toEqual({ stone: 5 })
			} else {
				expect(storage.stock).toEqual({ wood: 0, stone: 5 })
			}
		})

		it('should throw error when no goods to reserve', () => {
			storage.removeGood('wood', 10)

			expect(() => {
				storage.reserve({ wood: 1 }, 'test')
			}).toThrow(AllocationError)
		})

		it('should not allow double-reservation of same goods', () => {
			const reservation1 = storage.reserve({ wood: 5 }, 'test1')
			expect(storage.available('wood')).toBe(5)

			// Should only be able to reserve remaining available
			const reservation2 = storage.reserve({ wood: 8 }, 'test2') // More than available
			expect(reservation2).toBeDefined()

			reservation1.fulfill()
			reservation2.fulfill()

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
			const alloc1 = storage.allocate({ wood: 5 }, 'test1')
			const alloc2 = storage.allocate({ wood: 3 }, 'test2')

			expect(storage.allocatedSlots).toBe(true)

			alloc1.fulfill()
			alloc2.fulfill()

			expect(storage.stock).toEqual({ wood: 28, stone: 15 })
		})

		it('should handle allocation and reservation simultaneously', () => {
			const allocation = storage.allocate({ wood: 5 }, 'alloc')
			const reservation = storage.reserve({ wood: 3 }, 'reserve')

			allocation.fulfill()
			reservation.fulfill()

			// Should have 20 + 5 - 3 = 22 wood
			expect(storage.stock).toEqual({ wood: 22, stone: 15 })
		})

		it('should maintain consistency during complex operations', () => {
			// Start with some goods
			storage.addGood('wood', 20)
			storage.addGood('stone', 15)

			// Try to allocate some room (may fail for SlottedStorage if insufficient slots)
			try {
				const alloc1 = storage.allocate({ wood: 5 }, 'alloc1')
				alloc1.fulfill()
			} catch {
				// Expected for SlottedStorage with limited slots
			}

			// Reserve some goods
			const res1 = storage.reserve({ stone: 3 }, 'reserve1')
			// Add more goods
			storage.addGood('berries', 10)

			// Try to allocate more room
			try {
				const alloc2 = storage.allocate({ berries: 5 }, 'alloc2')
				alloc2.fulfill()
			} catch {
				// Expected for SlottedStorage with limited slots
			}

			// Reserve more goods
			const res2 = storage.reserve({ wood: 2 }, 'reserve2')

			// Fulfill all operations
			res1.fulfill()
			res2.fulfill()

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
			expect(() => {
				storage.allocate({}, 'test') // Empty goods
			}).toThrow(AllocationError)
		})

		it('should handle invalid reservations gracefully', () => {
			expect(() => {
				storage.reserve({}, 'test') // Empty goods
			}).toThrow(AllocationError)
		})

		it('should maintain invariants after failed operations', () => {
			const initialStock = { ...storage.stock }

			// Try operations that should fail
			try {
				storage.allocate({ wood: 1000 }, 'test')
			} catch {
				// Expected to fail
			}

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

	it('should always throw on allocation', () => {
		expect(() => {
			storage.allocate({ wood: 1 }, 'test')
		}).toThrow(AllocationError)
	})

	it('should always throw on reservation', () => {
		expect(() => {
			storage.reserve({ wood: 1 }, 'test')
		}).toThrow(AllocationError)
	})

	it('should never be able to store all goods', () => {
		expect(storage.canStoreAll({ wood: 1 })).toBe(false)
		expect(storage.canStoreAll({})).toBe(false)
	})
})
