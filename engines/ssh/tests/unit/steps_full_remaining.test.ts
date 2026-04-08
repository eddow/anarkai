import {
	ASingleStep,
	MoveToStep,
	QueueStep,
	stepPassesFullRemainingOnComplete,
	WaitForPredicateStep,
} from 'ssh/npcs/steps'
import { describe, expect, it } from 'vitest'

describe('fullRemainingOnComplete (useless-step guard)', () => {
	it('defaults to false on the base step kind', () => {
		expect(ASingleStep.fullRemainingOnComplete).toBe(false)
	})

	it('is true for steps that return full dt on successful completion', () => {
		expect(QueueStep.fullRemainingOnComplete).toBe(true)
		expect(WaitForPredicateStep.fullRemainingOnComplete).toBe(true)
	})

	it('is false for evolution-based steps', () => {
		expect(MoveToStep.fullRemainingOnComplete).toBe(false)
	})

	it('stepPassesFullRemainingOnComplete reads the static flag', () => {
		expect(stepPassesFullRemainingOnComplete(QueueStep)).toBe(true)
		expect(stepPassesFullRemainingOnComplete(WaitForPredicateStep)).toBe(true)
		expect(stepPassesFullRemainingOnComplete(MoveToStep)).toBe(false)
	})
})
