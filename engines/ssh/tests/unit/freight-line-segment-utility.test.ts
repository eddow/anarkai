import { type FreightLineUtilityWeights, freightLineUtilityWeights } from 'engine-rules'
import {
	applyVehicleCapacityCap,
	computeFreightLineSegmentUtility,
	transferableGoodsMin,
} from 'ssh/freight/freight-line-segment-utility'
import type { FreightStopGoodsSnapshot } from 'ssh/freight/freight-stop-utility'
import { describe, expect, it } from 'vitest'

const woodBerry = new Set(['wood', 'berries'] as const)

describe('freight-line-segment-utility', () => {
	it('transferableGoodsMin sums per-good mins additively (one zero good does not zero all)', () => {
		const source: FreightStopGoodsSnapshot = {
			perGood: { wood: 10, berries: 3 },
			total: 13,
		}
		const sink: FreightStopGoodsSnapshot = {
			perGood: { wood: 0, berries: 2 },
			total: 2,
		}
		const t = transferableGoodsMin(source, sink, woodBerry)
		expect(t.perGood.wood).toBe(0)
		expect(t.perGood.berries).toBe(2)
		expect(t.totalRaw).toBe(2)
	})

	it('applyVehicleCapacityCap clamps totalCapped', () => {
		const base = transferableGoodsMin(
			{ perGood: { wood: 10 }, total: 10 },
			{ perGood: { wood: 10 }, total: 10 },
			new Set(['wood'] as const)
		)
		const capped = applyVehicleCapacityCap(base, 4)
		expect(capped.totalCapped).toBe(4)
	})

	it('computeFreightLineSegmentUtility applies weights to distance, time, and staleness', () => {
		const weights: FreightLineUtilityWeights = {
			distance: 2,
			travelTime: 3,
			staleness: 5,
		}
		const source: FreightStopGoodsSnapshot = { perGood: { wood: 5 }, total: 5 }
		const sink: FreightStopGoodsSnapshot = { perGood: { wood: 5 }, total: 5 }
		const u = computeFreightLineSegmentUtility({
			source,
			sink,
			allowedGoods: new Set(['wood'] as const),
			vehicleCapacity: 10,
			travelDistance: 1,
			travelTime: 2,
			staleness: 0.4,
			weights,
		})
		expect(u.cargoScore).toBe(0.5)
		expect(u.distancePenalty).toBe(2)
		expect(u.timePenalty).toBe(6)
		expect(u.stalenessBonus).toBe(2)
		expect(u.score).toBe(0.5 - 2 - 6 + 2)
	})

	it('normalizes cargoScore when vehicleCapacity is set', () => {
		const u = computeFreightLineSegmentUtility({
			source: { perGood: { wood: 4 }, total: 4 },
			sink: { perGood: { wood: 10 }, total: 10 },
			allowedGoods: new Set(['wood'] as const),
			vehicleCapacity: 10,
			travelDistance: 0,
			travelTime: 0,
			staleness: 0,
			weights: freightLineUtilityWeights,
		})
		expect(u.cargoScore).toBe(0.4)
	})
})
