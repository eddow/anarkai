import {
	type ActivityScore,
	applyActivityHysteresis,
	excludeWanderAfterWanderWhenEmployable,
	type NextActivityKind,
} from 'ssh/population/findNextActivity'
import { describe, expect, it } from 'vitest'

function score(kind: NextActivityKind, utility: number): ActivityScore {
	return {
		kind,
		utility,
		timeSeconds: 0,
		penaltyBefore: 0,
		penaltyAfter: 0,
		detail: {},
	}
}

describe('applyActivityHysteresis', () => {
	it('keeps preferred activity first when within hysteresis gap', () => {
		const scores = [score('bestWork', 1.0), score('wander', 1.02)]
		const ranked = applyActivityHysteresis(scores, 'bestWork', 0.03)
		expect(ranked[0]?.kind).toBe('bestWork')
	})

	it('does not stick to wander when another kind is only slightly ahead', () => {
		const scores = [score('wander', 1.0), score('bestWork', 1.02)]
		const ranked = applyActivityHysteresis(scores, 'wander', 0.03)
		expect(ranked[0]?.kind).toBe('bestWork')
	})
})

describe('excludeWanderAfterWanderWhenEmployable', () => {
	const employable = {
		keepWorking: true,
		resolveBestJobMatch: () =>
			({ job: {} as never, targetTile: {} as never, path: [] as never }) as const,
	}
	const notEmployable = {
		keepWorking: true,
		resolveBestJobMatch: () => false as const,
	}

	it('removes wander from ranked list after wander when fit and a job exists', () => {
		const ranked = [score('wander', 2), score('bestWork', 1)]
		const next = excludeWanderAfterWanderWhenEmployable(ranked, 'wander', employable)
		expect(next.map((s) => s.kind)).toEqual(['bestWork'])
	})

	it('keeps wander when last pick was not wander', () => {
		const ranked = [score('wander', 2), score('bestWork', 1)]
		const next = excludeWanderAfterWanderWhenEmployable(ranked, 'bestWork', employable)
		expect(next).toEqual(ranked)
	})

	it('keeps wander when not keepWorking', () => {
		const ranked = [score('wander', 2)]
		const next = excludeWanderAfterWanderWhenEmployable(ranked, 'wander', {
			keepWorking: false,
			resolveBestJobMatch: employable.resolveBestJobMatch,
		})
		expect(next).toEqual(ranked)
	})

	it('keeps wander when no job match', () => {
		const ranked = [score('wander', 2), score('bestWork', 1)]
		const next = excludeWanderAfterWanderWhenEmployable(ranked, 'wander', notEmployable)
		expect(next).toEqual(ranked)
	})
})
