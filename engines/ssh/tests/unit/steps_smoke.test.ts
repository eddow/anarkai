import {
	ASingleStep,
	DurationStep,
	MoveToStep,
	MultiMoveStep,
	WaitForPredicateStep,
} from 'ssh/npcs/steps'
import { describe, expect, it, vi } from 'vitest'

describe('steps smoke', () => {
	it('WaitForPredicateStep fulfills once the predicate flips and passes through the full dt', () => {
		let ready = false
		const predicate = vi.fn(() => ready)
		const step = new WaitForPredicateStep('wait-until-ready', predicate)

		expect(step.description).toBe('wait-until-ready')
		expect(step.tick(0.25)).toBeUndefined()
		expect(predicate).toHaveBeenCalledTimes(1)

		ready = true

		expect(step.tick(0.25)).toBe(0.25)
		expect(predicate).toHaveBeenCalledTimes(2)
		expect(step.tick(0.25)).toBe(0.25)
		expect(predicate).toHaveBeenCalledTimes(2)
	})

	it('MoveToStep preserves progress across serialize/deserialize', () => {
		const walker = { position: { q: 0, r: 0 } }
		const step = new MoveToStep(10, walker, { q: 10, r: 0 }, 'walk', 'walk-east')

		expect(step.description).toBe('walk-east')
		expect(step.tick(2)).toBeUndefined()
		expect(walker.position.q).toBeCloseTo(2)

		const restoredWalker = { position: { q: 999, r: 999 } }
		const restored = ASingleStep.deserialize(
			{} as never,
			restoredWalker as never,
			step.serialize()
		) as MoveToStep

		expect(restored).toBeInstanceOf(MoveToStep)
		expect(restored.description).toBe('walk-east')
		expect(restoredWalker.position.q).toBeCloseTo(0)
		expect(restoredWalker.position.r).toBeCloseTo(0)

		expect(restored.tick(8)).toBeCloseTo(0)
		expect(restored.evolution).toBeCloseTo(1)
		expect(restoredWalker.position.q).toBeCloseTo(10)
		expect(restoredWalker.position.r).toBeCloseTo(0)
	})

	it('MultiMoveStep captures starting positions at construction time', () => {
		const actorA = { position: { q: 1, r: 1 } }
		const actorB = { position: { q: -2, r: 4 } }
		const step = new MultiMoveStep(10, [
			{ who: actorA, to: { q: 5, r: 1 } },
			{ who: actorB, to: { q: 2, r: 8 } },
		])

		actorA.position = { q: 100, r: 100 }
		actorB.position = { q: 100, r: 100 }

		expect(step.tick(5)).toBeUndefined()
		expect(actorA.position.q).toBeCloseTo(3)
		expect(actorA.position.r).toBeCloseTo(1)
		expect(actorB.position.q).toBeCloseTo(0)
		expect(actorB.position.r).toBeCloseTo(6)
	})

	it('DurationStep carries its type and description through deserialization and finishes cleanly', () => {
		const step = new DurationStep(4, 'work', 'Chopping Wood')

		expect(step.description).toBe('Chopping Wood')
		expect(step.tick(1)).toBeUndefined()

		const restored = ASingleStep.deserialize(
			{} as never,
			{} as never,
			step.serialize()
		) as DurationStep

		expect(restored).toBeInstanceOf(DurationStep)
		expect(restored.type).toBe('work')
		expect(restored.description).toBe('Chopping Wood')
		expect(restored.evolution).toBeCloseTo(0.25)
		expect(restored.tick(3)).toBeCloseTo(0)
		expect(restored.evolution).toBeCloseTo(1)
	})
})
