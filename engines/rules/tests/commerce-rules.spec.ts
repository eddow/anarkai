import { describe, expect, it } from 'vitest'
import { commerce, construction, goods, settlementTrade } from '../src'

describe('commerce and construction rules', () => {
	it('includes concrete as a priced construction good', () => {
		expect(goods.concrete.baseValueVp).toBe(10)
		expect(goods.concrete.tags).toContain('construction/concrete')
	})

	it('keeps foundation concrete in construction rules', () => {
		expect(construction.foundation.goods).toEqual({ concrete: 1 })
		expect(construction.foundation.time).toBe(3)
	})

	it('exports settlement trade tuning from rules', () => {
		expect(settlementTrade.goods).toContain('concrete')
		expect(settlementTrade.offerCounts).toMatchObject({ village: 2, town: 3, city: 4 })
		expect(settlementTrade.priceMultipliers.sell.village).toBeGreaterThan(
			settlementTrade.priceMultipliers.sell.city
		)
	})

	it('exports the initial player account balance from rules', () => {
		expect(commerce.startingAccountBalanceVp).toBeGreaterThan(0)
	})
})
