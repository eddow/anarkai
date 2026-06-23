import { isCompleteVehicleWorkPick } from 'ssh/freight/vehicle-work'
import { describe, expect, it } from 'vitest'

describe('vehicle work pick validation', () => {
	it('rejects incomplete zone browse picks before they reach work.goWork', () => {
		expect(
			isCompleteVehicleWorkPick({
				job: {
					job: 'zoneBrowse',
					urgency: 1,
					fatigue: 1,

					lineId: 'line:1',
					stopId: 'stop:1',
					path: [],
					approachPath: [],
				} as any,
				targetTile: {} as any,
			})
		).toBe(false)
	})

	it('allows anchor vehicle hops without zone transfer payload', () => {
		expect(
			isCompleteVehicleWorkPick({
				job: {
					job: 'vehicleHop',
					urgency: 1,
					fatigue: 1,

					lineId: 'line:1',
					stopId: 'stop:1',
					path: [],
					approachPath: [],
					dockEnter: true,
				},
				targetTile: {} as any,
			})
		).toBe(true)
	})
})
