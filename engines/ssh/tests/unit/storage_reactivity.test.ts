import { Commitment } from 'ssh/commitment'
import { SlottedStorage } from 'ssh/storage/slotted-storage'
import { SpecificStorage } from 'ssh/storage/specific-storage'
import { describe, expect, it } from 'vitest'

describe('SlottedStorage Reactivity', () => {
	it('updates availables when reserved (bug reproduction)', () => {
		const storage = new SlottedStorage(2, 10)

		// 1. Allocate a slot (creates non-reactive slot in current implementation)
		const allocCommitment = new Commitment('test')
		storage.allocate({ wood: 1 }, allocCommitment)

		const slot = storage.slots.find((s) => s && s.goodType === 'wood')
		expect(slot).toBeDefined()

		// 2. Fulfill it (quantity = 1).
		allocCommitment.fulfill()

		// 3. Trigger array reactivity to refresh availables cache
		// We add another good to a different slot, modifying the array.
		storage.addGood('stone', 1)

		// 4. Check availables. Should be correct now.
		expect(storage.availables.wood).toBe(1)

		// 5. Reserve the wood.
		// If slot is non-reactive/stale, availables might remain 1.
		storage.reserve({ wood: 1 }, new Commitment('test-reserve'))

		// Check fresh calc (available) - this always works
		expect(storage.available('wood')).toBe(0)

		// Check availables getter - this must match available()
		expect(storage.availables.wood || 0).toBe(0)
	})
})

describe.each([
	['SlottedStorage', () => new SlottedStorage(1, 2)],
	['SpecificStorage', () => new SpecificStorage({ wood: 2 })],
])('Storage presentation notifications: %s', (_name, createStorage) => {
	it('notifies on successful direct storage mutations only', () => {
		const storage = createStorage()
		let notifications = 0
		storage.setPresentationChangeNotifier(() => {
			notifications++
		})

		expect(storage.addGood('wood', 1)).toBe(1)
		expect(notifications).toBe(1)

		expect(storage.addGood('wood', 99)).toBe(1)
		expect(notifications).toBe(2)

		expect(storage.addGood('wood', 1)).toBe(0)
		expect(notifications).toBe(2)

		expect(storage.removeGood('wood', 1)).toBe(1)
		expect(notifications).toBe(3)

		expect(storage.removeGood('wood', 99)).toBe(1)
		expect(notifications).toBe(4)

		expect(storage.removeGood('wood', 1)).toBe(0)
		expect(notifications).toBe(4)
	})

	it('notifies on allocation and reservation lifecycle changes', () => {
		const storage = createStorage()
		let notifications = 0
		storage.setPresentationChangeNotifier(() => {
			notifications++
		})

		const allocation = new Commitment('presentation.allocate')
		expect(storage.allocate({ wood: 1 }, allocation)).toBeUndefined()
		expect(notifications).toBe(1)

		allocation.fulfill()
		expect(notifications).toBe(2)

		const reservation = new Commitment('presentation.reserve')
		expect(storage.reserve({ wood: 1 }, reservation)).toBeUndefined()
		expect(notifications).toBe(3)

		reservation.cancel('test')
		expect(notifications).toBe(4)
	})

	it('does not notify for failed allocation or reservation', () => {
		const storage = createStorage()
		let notifications = 0
		storage.setPresentationChangeNotifier(() => {
			notifications++
		})

		expect(storage.addGood('wood', 2)).toBe(2)
		notifications = 0
		expect(storage.allocate({ wood: 99 }, new Commitment('presentation.failed.allocate'))).toBe(
			'Insufficient room to allocate any goods'
		)
		const emptyStorage = createStorage()
		emptyStorage.setPresentationChangeNotifier(() => {
			notifications++
		})
		expect(emptyStorage.reserve({ wood: 1 }, new Commitment('presentation.failed.reserve'))).toBe(
			'Insufficient goods to reserve any goods'
		)
		expect(notifications).toBe(0)
	})
})
