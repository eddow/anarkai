import {
	consumePresentationEvents,
	presentationRevisionFor,
	resetPresentationRevisionsForTests,
} from './presentation-events'
import { beforeEach, describe, expect, it } from 'vitest'

describe('browser presentation event revisions', () => {
	beforeEach(() => {
		resetPresentationRevisionsForTests()
	})

	it('increments owner revisions from storage presentation events', () => {
		expect(presentationRevisionFor('tile:1,1')).toBe(0)

		consumePresentationEvents([
			{ type: 'storage.changed', ownerUid: 'tile:1,1' },
			{ type: 'storage.changed', ownerUid: 'tile:1,1' },
			{ type: 'storage.changed', ownerUid: 'vehicle:1' },
		])

		expect(presentationRevisionFor('tile:1,1')).toBe(2)
		expect(presentationRevisionFor('vehicle:1')).toBe(1)
		expect(presentationRevisionFor('tile:2,2')).toBe(0)
	})
})
