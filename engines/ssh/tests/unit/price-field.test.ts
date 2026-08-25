import type {
	Estate,
	EstateCommerceProfile,
	GoodFlow,
	PriceFieldTuning,
} from 'ssh/commerce/commerce-model'
import {
	estateDistanceToCoord,
	influenceWeight,
	priceAt,
	rateFieldAt,
} from 'ssh/commerce/price-field'
import { describe, expect, it } from 'vitest'

const tuning: PriceFieldTuning = { k: 0.05, alpha: 0.5, radius: 8, fadeRadius: 12 }

function estate(
	footprint: readonly { q: number; r: number }[],
	good: 'wood' | 'planks',
	flow: GoodFlow,
	feeds = true
): Estate {
	const profile: EstateCommerceProfile = { [good]: flow }
	return {
		footprint,
		profile,
		feedsPriceField: feeds,
		distanceTo: () => 0,
	}
}

// producer: +2 flow, half-full buffer (fill 0.5) → effectiveFlow = 2·(0.5 + 0.5·0.5) = 1.5
const producer = (good: 'wood' | 'planks', at: { q: number; r: number }): Estate =>
	estate([at], good, { normalizedDelta: 2, stock: 5, capacity: 10 })

// consumer: −2 flow, half-full (fill 0.5) → effectiveFlow = −2·(0.5 + 0.5·0.5) = −1.5
const consumer = (good: 'wood' | 'planks', at: { q: number; r: number }): Estate =>
	estate([at], good, { normalizedDelta: -2, stock: 5, capacity: 10 })

describe('influenceWeight', () => {
	it('is 1 at distance 0 and 0 at/after the radius', () => {
		expect(influenceWeight(0, 8)).toBe(1)
		expect(influenceWeight(8, 8)).toBe(0)
		expect(influenceWeight(20, 8)).toBe(0)
	})
	it('is the squared taper inside the radius', () => {
		// d=4, R=8 → 1 − (0.5)² = 0.75
		expect(influenceWeight(4, 8)).toBeCloseTo(0.75)
	})
	it('degenerates to a point when radius <= 0', () => {
		expect(influenceWeight(0, 0)).toBe(1)
		expect(influenceWeight(1, 0)).toBe(0)
	})
})

describe('estateDistanceToCoord', () => {
	it('is the min hex distance over the footprint', () => {
		const e = estate(
			[
				{ q: 0, r: 0 },
				{ q: 4, r: 0 },
			],
			'wood',
			{
				normalizedDelta: 1,
				stock: 0,
				capacity: 1,
			}
		)
		expect(estateDistanceToCoord(e, { q: 3, r: 0 })).toBe(1) // near the (4,0) tile
		expect(estateDistanceToCoord(e, { q: 0, r: 0 })).toBe(0)
	})
})

describe('rateFieldAt', () => {
	it('excludes non-feeding (commercial) estates', () => {
		const e = estate(
			[{ q: 0, r: 0 }],
			'wood',
			{ normalizedDelta: 2, stock: 5, capacity: 10 },
			false
		)
		expect(rateFieldAt([e], 'wood', { q: 0, r: 0 }, tuning)).toBe(0)
	})
	it('sums producer (+) and consumer (−) pressures at a point', () => {
		const p = producer('wood', { q: 0, r: 0 })
		const c = consumer('wood', { q: 2, r: 0 })
		const field = rateFieldAt([p, c], 'wood', { q: 1, r: 0 }, tuning)
		// both at distance 1 from (1,0): weight = 1−(1/8)² = 0.984375
		const w = 1 - (1 / 8) ** 2
		// producer +1.5·w, consumer −1.5·w → net 0
		expect(field).toBeCloseTo(1.5 * w - 1.5 * w, 10)
	})
	it('is higher (cheaper goods) near a producer than far away', () => {
		const p = producer('wood', { q: 0, r: 0 })
		const near = rateFieldAt([p], 'wood', { q: 0, r: 0 }, tuning)
		const far = rateFieldAt([p], 'wood', { q: 8, r: 0 }, tuning)
		expect(near).toBeGreaterThan(far)
		expect(far).toBe(0) // at the radius edge, weight is 0
	})
})

describe('priceAt', () => {
	it('is base when no estate feeds the good', () => {
		expect(priceAt([], 'wood', { q: 0, r: 0 }, tuning, 5)).toBe(5)
	})
	it('is cheaper near a producer (supply lowers price)', () => {
		const p = producer('wood', { q: 0, r: 0 })
		const atProducer = priceAt([p], 'wood', { q: 0, r: 0 }, tuning, 5)
		const far = priceAt([p], 'wood', { q: 8, r: 0 }, tuning, 5)
		expect(atProducer).toBeLessThan(5)
		expect(far).toBe(5) // no influence at the edge
		// supply field 1.5 → price = 5·exp(−0.05·1.5)
		expect(atProducer).toBeCloseTo(5 * Math.exp(-0.05 * 1.5))
	})
	it('is more expensive near a consumer (demand raises price)', () => {
		const c = consumer('wood', { q: 0, r: 0 })
		const atConsumer = priceAt([c], 'wood', { q: 0, r: 0 }, tuning, 5)
		expect(atConsumer).toBeGreaterThan(5)
		expect(atConsumer).toBeCloseTo(5 * Math.exp(-0.05 * -1.5))
	})
	it('ignores other goods', () => {
		const p = producer('planks', { q: 0, r: 0 })
		expect(priceAt([p], 'wood', { q: 0, r: 0 }, tuning, 5)).toBe(5)
	})
})
