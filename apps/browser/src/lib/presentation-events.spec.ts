import { beforeEach, describe, expect, it } from 'vitest'
import {
	consumePresentationEvents,
	presentationRevisionFor,
	resetPresentationRevisionsForTests,
	workPlanningPresentationRevision,
} from './presentation-events'

describe('browser presentation event revisions', () => {
	beforeEach(() => {
		resetPresentationRevisionsForTests()
	})

	it('increments owner revisions from storage presentation events', () => {
		const tileA: any = {}
		const tileB: any = {}
		const vehicle: any = {}

		expect(presentationRevisionFor(tileA)).toBe(0)

		consumePresentationEvents([
			{ type: 'storage.changed', owner: tileA },
			{ type: 'storage.changed', owner: tileA },
			{ type: 'storage.changed', owner: vehicle },
		])

		expect(presentationRevisionFor(tileA)).toBe(2)
		expect(presentationRevisionFor(vehicle)).toBe(1)
		expect(presentationRevisionFor(tileB)).toBe(0)
	})

	it('increments owner revisions from dock presentation events', () => {
		const dockTile: any = {}

		consumePresentationEvents([
			{
				type: 'vehicle.dock.changed',
				owner: dockTile,
				vehicle: {} as any,
			},
		])

		expect(presentationRevisionFor(dockTile)).toBe(1)
	})

	it('tracks work-planning presentation revisions', () => {
		expect(workPlanningPresentationRevision()).toBe(0)

		consumePresentationEvents([{ type: 'work-planning.changed', revision: 7 }])

		expect(workPlanningPresentationRevision()).toBe(7)
	})
})
