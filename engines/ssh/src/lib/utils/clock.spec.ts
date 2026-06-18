import { describe, expect, it } from 'vitest'
import { Clock, type Clocked } from './clock'

// ─── Helpers ───────────────────────────────────────────────────────────────

interface CallRecord {
	type: 'progress' | 'complete'
	ds: number
	tag: string
}

function step(tag: string, calls: CallRecord[]): Clocked {
	return {
		get remainingDs() {
			return 0
		},
		progress(ds: number) {
			calls.push({ type: 'progress', ds, tag })
		},
		complete() {
			calls.push({ type: 'complete', ds: 0, tag })
			return undefined
		},
	}
}

// ─── begin & advance: basic ordering ───────────────────────────────────────

describe('begin + advance ordering', () => {
	it('fires timed steps in correct order', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []

		clock.begin(step('c', calls), 0.3)
		clock.begin(step('a', calls), 0.1)
		clock.begin(step('b', calls), 0.2)

		clock.advance(1.0)

		const completes = calls.filter((c) => c.type === 'complete')
		expect(completes.map((c) => c.tag)).toEqual(['a', 'b', 'c'])
	})

	it('fires single step at correct time', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []
		const a = step('a', calls)

		clock.begin(a, 2.5)
		expect(calls).toHaveLength(0)

		clock.advance(2.0)
		expect(calls.filter((c) => c.type === 'complete')).toHaveLength(0)

		clock.advance(0.5)
		expect(calls.filter((c) => c.type === 'complete')).toHaveLength(1)
	})

	it('advance(0) fires nothing', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []
		clock.begin(step('a', calls), 0.1)
		clock.advance(0)
		expect(calls).toHaveLength(0)
	})

	it('advance with negative ds is no-op', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []
		clock.begin(step('a', calls), 0.1)
		clock.advance(-1)
		expect(calls).toHaveLength(0)
	})
})

// ─── Partial advance ───────────────────────────────────────────────────────

describe('partial advance', () => {
	it('progresses head but does not complete when advance < relDs', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []
		const a = step('a', calls)
		const b = step('b', calls)

		clock.begin(a, 1.0)
		clock.begin(b, 3.0)

		clock.advance(0.6)
		expect(calls.filter((c) => c.type === 'complete')).toHaveLength(0)

		const progressCalls = calls.filter((c) => c.type === 'progress')
		expect(progressCalls).toHaveLength(2)
		expect(progressCalls[0]!.ds).toBeCloseTo(0.6, 5)
		expect(progressCalls[1]!.ds).toBeCloseTo(0.6, 5)
	})

	it('head relDs shrinks correctly across partial advances', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []
		clock.begin(step('a', calls), 1.0)

		expect(clock.dump()[0]!.effDs).toBeCloseTo(1.0, 5)

		clock.advance(0.3)
		expect(clock.dump()[0]!.effDs).toBeCloseTo(0.7, 5)

		clock.advance(0.3)
		expect(clock.dump()[0]!.effDs).toBeCloseTo(0.4, 5)
	})

	it('multiple partial advances accumulate correctly', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []
		const a = step('a', calls)

		clock.begin(a, 2.0)
		clock.advance(0.5)
		clock.advance(0.5)
		clock.advance(0.5)
		expect(calls.filter((c) => c.type === 'complete')).toHaveLength(0)

		clock.advance(0.5)
		expect(calls.filter((c) => c.type === 'complete')).toHaveLength(1)
	})
})

// ─── Parallel progress ─────────────────────────────────────────────────────

describe('parallel progress', () => {
	it('all active timed steps progress in parallel each advance', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []
		const a = step('a', calls)
		const b = step('b', calls)
		const c = step('c', calls)

		clock.begin(a, 1.0)
		clock.begin(b, 2.0)
		clock.begin(c, 5.0)

		clock.advance(0.5)

		const progressCalls = calls.filter((c) => c.type === 'progress')
		expect(progressCalls).toHaveLength(3)
		expect(progressCalls.find((c) => c.tag === 'a')!.ds).toBeCloseTo(0.5, 5)
		expect(progressCalls.find((c) => c.tag === 'b')!.ds).toBeCloseTo(0.5, 5)
		expect(progressCalls.find((c) => c.tag === 'c')!.ds).toBeCloseTo(0.5, 5)
	})

	it('step inserted mid-advance gets only post-insertion progress', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []
		const b = step('b', calls)
		const c = step('c', calls)

		let cInserted = false

		const a: Clocked = {
			get remainingDs() {
				return 0
			},
			progress(ds: number) {
				calls.push({ type: 'progress', ds, tag: 'a' })
			},
			complete() {
				calls.push({ type: 'complete', ds: 0, tag: 'a' })
				if (!cInserted) {
					cInserted = true
					clock.begin(c, 1.0)
				}
				return undefined
			},
		}

		clock.begin(a, 2.0)
		clock.begin(b, 5.0)

		calls.length = 0
		clock.advance(3.0)

		// b survived: full 3.0 progress in post-loop
		const bProgress = calls.filter((c) => c.type === 'progress' && c.tag === 'b')
		expect(bProgress).toHaveLength(1)
		expect(bProgress[0]!.ds).toBeCloseTo(3.0, 5)

		// c was completed during the while loop — progress has no side-effects,
		// so calling it just before complete() is pointless (the bar would be hidden same frame).
		// Therefore c gets no progress call.
		const cProgress = calls.filter((c) => c.type === 'progress' && c.tag === 'c')
		expect(cProgress).toHaveLength(0)
	})
})

// ─── Completion & chaining ─────────────────────────────────────────────────

describe('completion & chaining', () => {
	it('complete() is called exactly once per timed step', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []
		const a = step('a', calls)
		const b = step('b', calls)

		clock.begin(a, 0.5)
		clock.begin(b, 1.0)

		clock.advance(2.0)
		expect(calls.filter((c) => c.type === 'complete')).toHaveLength(2)
	})

	it('step inserted with ds=0 during complete() fires same frame', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []
		const b = step('b', calls)

		let bInserted = false
		const a: Clocked = {
			get remainingDs() {
				return 0
			},
			progress(_ds: number) {},
			complete() {
				calls.push({ type: 'complete', ds: 0, tag: 'a' })
				if (!bInserted) {
					bInserted = true
					clock.begin(b, 0)
				}
				return undefined
			},
		}

		clock.begin(a, 1.0)
		clock.advance(1.0)

		expect(calls.filter((c) => c.type === 'complete').map((c) => c.tag)).toEqual(['a', 'b'])
	})

	it('step inserted with ds > remaining does NOT complete same frame', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []
		const b = step('b', calls)

		let bInserted = false
		const a: Clocked = {
			get remainingDs() {
				return 0
			},
			progress(_ds: number) {},
			complete() {
				calls.push({ type: 'complete', ds: 0, tag: 'a' })
				if (!bInserted) {
					bInserted = true
					clock.begin(b, 0.5)
				}
				return undefined
			},
		}

		clock.begin(a, 1.0)
		clock.advance(1.0)

		expect(calls.filter((c) => c.type === 'complete').map((c) => c.tag)).toEqual(['a'])
		expect(clock.size).toBe(1)

		clock.advance(0.5)
		expect(calls.filter((c) => c.type === 'complete').map((c) => c.tag)).toEqual(['a', 'b'])
	})
})

// ─── Off-clock steps ───────────────────────────────────────────────────────

describe('off-clock steps', () => {
	it('off-clock step is progressed each frame but never completed by clock', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []
		const q = step('queue', calls)

		clock.begin(q)
		clock.advance(2.0)

		// Progress for animation, no completion
		expect(calls.filter((c) => c.type === 'progress')).toHaveLength(1)
		expect(calls.filter((c) => c.type === 'progress')[0]!.ds).toBeCloseTo(2.0, 5)
		expect(calls.filter((c) => c.type === 'complete')).toHaveLength(0)

		calls.length = 0
		clock.advance(3.0)
		expect(calls.filter((c) => c.type === 'progress')).toHaveLength(1)
		expect(calls.filter((c) => c.type === 'progress')[0]!.ds).toBeCloseTo(3.0, 5)
		expect(calls.filter((c) => c.type === 'complete')).toHaveLength(0)
	})

	it('off-clock step can be explicitly completed', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []

		const q: Clocked = {
			get remainingDs() {
				return 0
			},
			progress(_ds: number) {},
			complete() {
				calls.push({ type: 'complete', ds: 0, tag: 'queue' })
				return undefined
			},
		}

		clock.begin(q)
		q.complete()
		expect(calls).toHaveLength(1)
	})

	it('timed steps still advance alongside off-clock entries', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []
		const t = step('timed', calls)

		clock.begin(step('offclock', []))
		clock.begin(t, 1.0)

		clock.advance(1.0)
		expect(calls.filter((c) => c.type === 'complete').map((c) => c.tag)).toEqual(['timed'])
	})

	it('begin(timed) replaces existing off-clock entry', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []
		const q = step('q', calls)

		clock.begin(q)
		expect(clock.size).toBe(1)

		clock.begin(q, 0.5)
		expect(clock.size).toBe(1)

		clock.advance(0.5)
		expect(calls.filter((c) => c.type === 'complete')).toHaveLength(1)
	})
})

// ─── remove ─────────────────────────────────────────────────────────────────

describe('remove', () => {
	it('removes a step and passes gap to next', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []
		const a = step('a', calls)
		const b = step('b', calls)
		const c = step('c', calls)

		clock.begin(a, 0.1)
		clock.begin(b, 0.2)
		clock.begin(c, 0.3)

		clock.remove(b)

		clock.advance(0.6)
		expect(calls.filter((c) => c.type === 'complete').map((c) => c.tag)).toEqual(['a', 'c'])
	})

	it('remove is idempotent', () => {
		const clock = new Clock()
		const a = step('a', [])
		clock.begin(a, 1.0)
		clock.remove(a)
		expect(clock.size).toBe(0)
		expect(() => clock.remove(a)).not.toThrow()
	})

	it('remove head passes gap to next entry', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []
		const a = step('a', calls)
		const b = step('b', calls)

		clock.begin(a, 0.1)
		clock.begin(b, 0.2)

		clock.remove(a)

		clock.advance(0.3)
		expect(calls.filter((c) => c.type === 'complete').map((c) => c.tag)).toEqual(['b'])
	})
})

// ─── serializeTime ──────────────────────────────────────────────────────────

describe('serializeTime', () => {
	it('returns effective ds from now for each step', () => {
		const clock = new Clock()

		const a: Clocked = {
			get remainingDs() {
				return clock.serializeTime(this) ?? 0
			},
			progress(_ds: number) {},
			complete() {
				return undefined
			},
		}
		const b: Clocked = {
			get remainingDs() {
				return clock.serializeTime(this) ?? 0
			},
			progress(_ds: number) {},
			complete() {
				return undefined
			},
		}

		clock.begin(a, 0.5)
		clock.begin(b, 1.0)

		expect(a.remainingDs).toBeCloseTo(0.5, 5)
		expect(b.remainingDs).toBeCloseTo(1.0, 5)

		clock.advance(0.3)
		expect(a.remainingDs).toBeCloseTo(0.2, 5)
		expect(b.remainingDs).toBeCloseTo(0.7, 5)
	})

	it('returns undefined for steps not on the clock', () => {
		const clock = new Clock()
		const s: Clocked = {
			get remainingDs() {
				return clock.serializeTime(this) ?? 0
			},
			progress(_ds: number) {},
			complete() {
				return undefined
			},
		}

		expect(s.remainingDs).toBe(0)
	})

	it('returns undefined for off-clock steps', () => {
		const clock = new Clock()
		const s: Clocked = {
			get remainingDs() {
				return clock.serializeTime(this) ?? 999
			},
			progress(_ds: number) {},
			complete() {
				return undefined
			},
		}

		clock.begin(s)
		expect(s.remainingDs).toBe(999)
	})

	it('cache is invalidated by advance', () => {
		const clock = new Clock()
		const a: Clocked = {
			get remainingDs() {
				return clock.serializeTime(this) ?? 0
			},
			progress(_ds: number) {},
			complete() {
				return undefined
			},
		}

		clock.begin(a, 1.0)
		expect(a.remainingDs).toBeCloseTo(1.0, 5)

		clock.advance(0.5)
		expect(a.remainingDs).toBeCloseTo(0.5, 5)

		clock.advance(0.5)
		expect(a.remainingDs).toBe(0)
	})

	it('cache is invalidated by begin', () => {
		const clock = new Clock()
		const a: Clocked = {
			get remainingDs() {
				return clock.serializeTime(this) ?? 0
			},
			progress(_ds: number) {},
			complete() {
				return undefined
			},
		}

		clock.begin(a, 3.0)
		expect(a.remainingDs).toBeCloseTo(3.0, 5)

		clock.begin(a, 1.0)
		expect(a.remainingDs).toBeCloseTo(1.0, 5)
	})

	it('cache is invalidated by remove', () => {
		const clock = new Clock()
		const a: Clocked = {
			get remainingDs() {
				return clock.serializeTime(this) ?? 0
			},
			progress(_ds: number) {},
			complete() {
				return undefined
			},
		}

		clock.begin(a, 1.0)
		expect(a.remainingDs).toBeCloseTo(1.0, 5)

		clock.remove(a)
		expect(a.remainingDs).toBe(0)
	})
})

// ─── Determinism ────────────────────────────────────────────────────────────

describe('determinism', () => {
	it('same schedule yields same completion order regardless of advance chunking', () => {
		function run(chunks: number[]): string[] {
			const clock = new Clock()
			const calls: CallRecord[] = []

			clock.begin(step('c', calls), 0.3)
			clock.begin(step('a', calls), 0.1)
			clock.begin(step('b', calls), 0.2)

			let remaining = 1.0
			for (const chunk of chunks) {
				const ds = Math.min(chunk, remaining)
				clock.advance(ds)
				remaining -= ds
				if (remaining <= 0) break
			}
			if (remaining > 0) clock.advance(remaining)

			return calls.filter((c) => c.type === 'complete').map((c) => c.tag)
		}

		expect(run([1.0])).toEqual(['a', 'b', 'c'])
		expect(run(Array(10).fill(0.1))).toEqual(['a', 'b', 'c'])
		expect(run([0.05, 0.95])).toEqual(['a', 'b', 'c'])
		expect(run([0.06, 0.04, 0.9])).toEqual(['a', 'b', 'c'])
	})

	it('recurring schedule yields same invocation count regardless of chunking', () => {
		function countInvocations(chunks: number[]): number {
			const clock = new Clock()
			let count = 0

			const schedule = (ds: number): void => {
				const wrapper: Clocked = {
					get remainingDs() {
						return 0
					},
					progress(_ds: number) {},
					complete() {
						count++
						schedule(ds)
						return undefined
					},
				}
				clock.begin(wrapper, ds)
			}
			schedule(1.0)

			let remaining = 5.0
			for (const chunk of chunks) {
				const ds = Math.min(chunk, remaining)
				clock.advance(ds)
				remaining -= ds
				if (remaining <= 0) break
			}
			if (remaining > 0) clock.advance(remaining)

			return count
		}

		expect(countInvocations([5.0])).toBe(5)
		expect(countInvocations(Array(50).fill(0.1))).toBe(5)
		expect(countInvocations([0.3, 1.7, 2.0, 1.0])).toBe(5)
	})
})

// ─── Edge cases ─────────────────────────────────────────────────────────────

describe('edge cases', () => {
	it('empty clock advance does nothing', () => {
		const clock = new Clock()
		expect(() => clock.advance(10.0)).not.toThrow()
		expect(clock.size).toBe(0)
	})

	it('oversized advance fires everything', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []

		clock.begin(step('a', calls), 0.1)
		clock.begin(step('b', calls), 0.2)
		clock.begin(step('c', calls), 0.3)

		clock.advance(100.0)
		expect(calls.filter((c) => c.type === 'complete')).toHaveLength(3)
		expect(clock.size).toBe(0)
	})

	it('size reflects pending entries', () => {
		const clock = new Clock()
		expect(clock.size).toBe(0)

		clock.begin(step('a', []), 1.0)
		clock.begin(step('b', []), 2.0)
		expect(clock.size).toBe(2)

		clock.advance(1.0)
		expect(clock.size).toBe(1)

		clock.advance(1.0)
		expect(clock.size).toBe(0)
	})

	it('begin same step twice replaces it', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []
		const a = step('a', calls)

		clock.begin(a, 5.0)
		clock.begin(a, 0.5)

		expect(clock.size).toBe(1)
		clock.advance(0.5)
		expect(calls.filter((c) => c.type === 'complete')).toHaveLength(1)
	})

	it('dump returns correct effective delays', () => {
		const clock = new Clock()
		const a = step('a', [])
		const b = step('b', [])

		clock.begin(a, 0.3)
		clock.begin(b, 0.7)

		const d = clock.dump()
		expect(d).toHaveLength(2)
		expect(d[0]!.effDs).toBeCloseTo(0.3, 5)
		expect(d[1]!.effDs).toBeCloseTo(0.7, 5)

		clock.advance(0.2)
		const d2 = clock.dump()
		expect(d2[0]!.effDs).toBeCloseTo(0.1, 5)
		expect(d2[1]!.effDs).toBeCloseTo(0.5, 5)
	})

	it('many steps interleave correctly', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []

		clock.begin(step('s0', calls), 0.5)
		clock.begin(step('s1', calls), 0.1)
		clock.begin(step('s2', calls), 0.8)
		clock.begin(step('s3', calls), 0.3)
		clock.begin(step('s4', calls), 0.6)
		clock.begin(step('s5', calls), 0.2)
		clock.begin(step('s6', calls), 0.9)
		clock.begin(step('s7', calls), 0.4)
		clock.begin(step('s8', calls), 0.7)
		clock.begin(step('s9', calls), 0.0)

		clock.advance(2.0)

		const completeTags = calls.filter((c) => c.type === 'complete').map((c) => c.tag)
		expect(completeTags).toEqual(['s9', 's1', 's5', 's3', 's7', 's0', 's4', 's8', 's2', 's6'])
	})

	it('progress ds matches the advance ds, not step duration', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []
		const a = step('a', calls)

		clock.begin(a, 2.0)
		clock.advance(0.7)

		const progressCalls = calls.filter((c) => c.type === 'progress')
		expect(progressCalls).toHaveLength(1)
		expect(progressCalls[0]!.ds).toBeCloseTo(0.7, 5)
	})
})

// ─── progress & complete separation ────────────────────────────────────────

describe('progress & complete separation', () => {
	it('progress is called for all live steps regardless of completion', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []
		const a = step('a', calls)
		const b = step('b', calls)

		clock.begin(a, 0.5)
		clock.begin(b, 2.0)

		clock.advance(0.5)

		// a completed during loop (no progress on completion), b survives → progress
		expect(calls.filter((c) => c.type === 'progress').map((c) => c.tag)).toEqual(['b'])
		expect(calls.filter((c) => c.type === 'complete').map((c) => c.tag)).toEqual(['a'])
	})

	it('completed step receives no further calls', () => {
		const clock = new Clock()
		const calls: CallRecord[] = []
		const a = step('a', calls)

		clock.begin(a, 0.5)
		clock.advance(0.5)
		// a completed, no progress-on-complete → zero progress calls
		expect(calls.filter((c) => c.type === 'progress' && c.tag === 'a')).toHaveLength(0)

		calls.length = 0
		clock.advance(1.0)
		expect(calls.filter((c) => c.tag === 'a')).toHaveLength(0)
	})
})
