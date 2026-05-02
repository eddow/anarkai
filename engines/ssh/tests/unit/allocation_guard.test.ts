import { Commitment } from 'ssh/commitment'
import { debugActiveAllocations, resetDebugActiveAllocations } from 'ssh/storage/guard'
import { SlottedStorage } from 'ssh/storage/slotted-storage'
import { SpecificStorage } from 'ssh/storage/specific-storage'
import { afterEach, describe, expect, it } from 'vitest'

function activeIds() {
	return debugActiveAllocations().map((held) => ({
		id: held.id,
		type: held.reason?.type ?? 'unknown',
	}))
}

describe('allocation guard', () => {
	afterEach(() => {
		resetDebugActiveAllocations()
	})

	it('releases specific storage tokens after fulfill', () => {
		resetDebugActiveAllocations()
		const storage = new SpecificStorage({ wood: 4 })
		storage.addGood('wood', 2)

		const sourceCommitment = new Commitment('test.reserve')
		const targetCommitment = new Commitment('test.allocate')
		storage.reserve({ wood: 1 }, sourceCommitment)
		storage.allocate({ wood: 1 }, targetCommitment)

		sourceCommitment.fulfill()
		targetCommitment.fulfill()

		expect(storage.stock.wood).toBe(2)
		expect(activeIds()).toEqual([])
	})

	it('releases slotted storage tokens after fulfill', () => {
		resetDebugActiveAllocations()
		const storage = new SlottedStorage(2, 2)
		storage.addGood('wood', 1)

		const sourceCommitment = new Commitment('test.reserve')
		const targetCommitment = new Commitment('test.allocate')
		storage.reserve({ wood: 1 }, sourceCommitment)
		storage.allocate({ wood: 1 }, targetCommitment)

		sourceCommitment.fulfill()
		targetCommitment.fulfill()

		expect(storage.stock.wood).toBe(1)
		expect(activeIds()).toEqual([])
	})
})
