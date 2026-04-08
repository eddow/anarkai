import {
	type ActivityScore,
	activityUtilityConfig,
	applyActivityHysteresis,
	totalNeedPenalty,
} from 'ssh/population/findNextActivity'
import { describe, expect, it } from 'vitest'

function score(
	kind: ActivityScore['kind'],
	utility: number,
	time = 1,
	penaltyBefore = 0,
	penaltyAfter = 0
): ActivityScore {
	return { kind, utility, timeSeconds: time, penaltyBefore, penaltyAfter, detail: {} }
}

describe('findNextActivity utilities', () => {
	it('totalNeedPenalty rises when hunger deficit grows', () => {
		const calm = totalNeedPenalty(0, 0, 0, activityUtilityConfig)
		const hungry = totalNeedPenalty(0.8, 0, 0, activityUtilityConfig)
		expect(hungry).toBeGreaterThan(calm)
	})

	it('applyActivityHysteresis keeps prior pick when within epsilon of top', () => {
		const ranked = [score('eat', 1.02), score('wander', 1.0), score('home', 0.5)]
		const out = applyActivityHysteresis(ranked, 'wander', 0.05)
		expect(out[0].kind).toBe('wander')
		expect(out[1].kind).toBe('eat')
	})

	it('applyActivityHysteresis does not reorder when gap is large', () => {
		const ranked = [score('eat', 2), score('wander', 0.5)]
		const out = applyActivityHysteresis(ranked, 'wander', 0.05)
		expect(out[0].kind).toBe('eat')
	})
})
