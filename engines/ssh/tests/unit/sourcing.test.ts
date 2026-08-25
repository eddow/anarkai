import type { NeededGood, Source } from 'ssh/commerce/commerce-model'
import {
	compareSourceOffers,
	internalSourceAvailability,
	reserveFor,
	resolveSourcing,
	type SourceOffer,
	type SourcingPolicy,
} from 'ssh/commerce/sourcing'
import { describe, expect, it } from 'vitest'

// Identity fixtures — the pure resolver never inspects `Source` internals.
const OWN = { id: 'own-hive' } as unknown as Source
const NPC_A = { id: 'npc-a' } as unknown as Source
const NPC_B = { id: 'npc-b' } as unknown as Source

const policy: SourcingPolicy = { reserve: { defaultReserve: 5, perGood: { wood: 2 } } }

const need = (good: 'wood' | 'stone', quantity: number): NeededGood => ({
	good,
	quantity,
	source: { id: 'site' } as unknown as NeededGood['source'],
})

const offer = (
	source: Source,
	good: 'wood' | 'stone',
	quantity: number,
	priceVp: number,
	distance: number
): SourceOffer => ({ source, good, quantity, priceVp, distance })

describe('reserveFor', () => {
	it('uses the per-good override, else the default', () => {
		expect(reserveFor(policy, 'wood')).toBe(2)
		expect(reserveFor(policy, 'stone')).toBe(5)
	})
})

describe('internalSourceAvailability', () => {
	it('subtracts own demand + reserve, floored at 0', () => {
		expect(internalSourceAvailability(20, 3, 5)).toBe(12)
		expect(internalSourceAvailability(7, 3, 5)).toBe(0)
		expect(internalSourceAvailability(20, 3, 0)).toBe(17)
	})
})

describe('compareSourceOffers', () => {
	it('ranks internal before external', () => {
		expect(
			compareSourceOffers(offer(OWN, 'wood', 1, 0, 100), offer(NPC_A, 'wood', 1, 1, 0))
		).toBeLessThan(0)
	})
	it('ranks cheaper external first', () => {
		expect(
			compareSourceOffers(offer(NPC_A, 'wood', 1, 1, 0), offer(NPC_B, 'wood', 1, 2, 0))
		).toBeLessThan(0)
	})
	it('breaks price ties by distance', () => {
		expect(
			compareSourceOffers(offer(NPC_A, 'wood', 1, 2, 1), offer(NPC_B, 'wood', 1, 2, 5))
		).toBeLessThan(0)
	})
})

describe('resolveSourcing', () => {
	it('returns a concrete quota when an internal source fully satisfies', () => {
		const entries = resolveSourcing([need('wood', 10)], [offer(OWN, 'wood', 15, 0, 0)], policy)
		expect(entries).toEqual([{ good: 'wood', source: OWN, quota: 10 }])
	})

	it('fills internal-first, then marks the external source as the remainder', () => {
		const entries = resolveSourcing(
			[need('wood', 10)],
			[offer(NPC_A, 'wood', 100, 3, 4), offer(OWN, 'wood', 4, 0, 0)],
			policy
		)
		expect(entries).toEqual([
			{ good: 'wood', source: OWN, quota: 4 },
			{ good: 'wood', source: NPC_A, quota: 'rest' },
		])
	})

	it('ranks external sources by price then distance', () => {
		const entries = resolveSourcing(
			[need('wood', 10)],
			[
				offer(NPC_B, 'wood', 100, 3, 0), // expensive but near
				offer(NPC_A, 'wood', 4, 1, 50), // cheap but far
			],
			policy
		)
		// cheap far source fills its 4 first, then the expensive near source takes the rest.
		expect(entries).toEqual([
			{ good: 'wood', source: NPC_A, quota: 4 },
			{ good: 'wood', source: NPC_B, quota: 'rest' },
		])
	})

	it('aggregates multiple needs for the same good', () => {
		const entries = resolveSourcing(
			[need('wood', 3), need('wood', 5)],
			[offer(OWN, 'wood', 20, 0, 0)],
			policy
		)
		expect(entries).toEqual([{ good: 'wood', source: OWN, quota: 8 }])
	})

	it('drops the unsatisfiable remainder (never fabricates supply)', () => {
		const entries = resolveSourcing([need('stone', 10)], [], policy)
		expect(entries).toEqual([])
	})

	it('keeps goods independent', () => {
		const entries = resolveSourcing(
			[need('wood', 10), need('stone', 6)],
			[offer(OWN, 'wood', 10, 0, 0), offer(OWN, 'stone', 3, 0, 0)],
			policy
		)
		expect(entries).toEqual([
			{ good: 'wood', source: OWN, quota: 10 },
			{ good: 'stone', source: OWN, quota: 3 },
		])
	})
})
