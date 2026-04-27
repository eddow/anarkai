import { jobBalance } from 'engine-rules'
import {
	scoreVehicleCandidate,
	vehicleCandidateFallbackOnly,
} from 'ssh/freight/vehicle-candidate-policy'
import { describe, expect, it } from 'vitest'

describe('vehicle-candidate-policy', () => {
	it('orders priority tiers at equal urgency and distance', () => {
		const base = { kind: 'zoneLoad' as const, urgency: 10, distance: 2 }
		const joint = scoreVehicleCandidate({ ...base, priorityTier: 'lineAndOffloadJoint' })
		const offload = scoreVehicleCandidate({ ...base, priorityTier: 'pureOffload' })
		const line = scoreVehicleCandidate({ ...base, priorityTier: 'pureLine' })

		expect(joint.score).toBeGreaterThan(offload.score)
		expect(offload.score).toBeGreaterThan(line.score)
	})

	it('uses distance plus one as the denominator', () => {
		const score = scoreVehicleCandidate({
			kind: 'maintenanceLoad',
			urgency: 12,
			distance: 3,
		})

		expect(score.distanceDenominator).toBe(4)
		expect(score.score).toBe(3)
	})

	it('applies quantity to provide-style candidates by default', () => {
		const one = scoreVehicleCandidate({
			kind: 'zoneProvide',
			urgency: jobBalance.provideFromVehicle,
			distance: 0,
			quantity: 1,
		})
		const three = scoreVehicleCandidate({
			kind: 'zoneProvide',
			urgency: jobBalance.provideFromVehicle,
			distance: 0,
			quantity: 3,
		})

		expect(three.score).toBe(one.score * 3)
	})

	it('applies quantity to dock transfer candidates by default', () => {
		const one = scoreVehicleCandidate({
			kind: 'dockDemand',
			urgency: jobBalance.loadOntoVehicle,
			distance: 0,
			quantity: 1,
		})
		const three = scoreVehicleCandidate({
			kind: 'dockDemand',
			urgency: jobBalance.loadOntoVehicle,
			distance: 0,
			quantity: 3,
		})

		expect(three.score).toBe(one.score * 3)
	})

	it('does not apply quantity to load-style candidates unless requested', () => {
		const load = scoreVehicleCandidate({
			kind: 'zoneLoad',
			urgency: jobBalance.loadOntoVehicle,
			distance: 0,
			quantity: 3,
		})
		const explicit = scoreVehicleCandidate({
			kind: 'zoneLoad',
			urgency: jobBalance.loadOntoVehicle,
			distance: 0,
			quantity: 3,
			quantityAffectsScore: true,
		})

		expect(load.quantityWeight).toBe(1)
		expect(explicit.quantityWeight).toBe(3)
	})

	it('marks park as fallback-only instead of a normal competitor', () => {
		expect(vehicleCandidateFallbackOnly('park')).toBe(true)
		expect(scoreVehicleCandidate({ kind: 'park', urgency: 17, distance: 1 }).fallbackOnly).toBe(
			true
		)
		expect(vehicleCandidateFallbackOnly('maintenanceLoad')).toBe(false)
	})
})
