import type { ExecutionState } from 'npc-script'
import {
	goWorkLocalsFromExecutionState,
	loopEntriesForNpcTrace,
	summarizeJobPlanForDiagnostics,
	summarizeScriptRunValueKind,
} from 'ssh/npcs/npc-diagnostics'
import { describe, expect, it } from 'vitest'

class FakeStep {}

describe('npc-diagnostics', () => {
	it('summarizeScriptRunValueKind covers common run results', () => {
		expect(summarizeScriptRunValueKind(undefined)).toBe('undefined')
		expect(summarizeScriptRunValueKind(null)).toBe('null')
		expect(summarizeScriptRunValueKind(0)).toBe('number')
		expect(summarizeScriptRunValueKind(new FakeStep())).toBe('FakeStep')
	})

	it('loopEntriesForNpcTrace maps value kinds', () => {
		const tail = loopEntriesForNpcTrace(
			[
				{ name: 'goWork', type: 'return', value: undefined },
				{ name: 'goWork', type: 'yield', value: { constructor: { name: 'MoveToStep' } } },
			],
			5
		)
		expect(tail).toEqual([
			{ name: 'goWork', type: 'return', valueKind: 'undefined' },
			{ name: 'goWork', type: 'yield', valueKind: 'MoveToStep' },
		])
	})

	it('summarizeJobPlanForDiagnostics keeps primitives for vehicle jobs', () => {
		expect(
			summarizeJobPlanForDiagnostics({
				job: 'vehicleHop',
				type: 'work',
				vehicleUid: 'v1',
				lineId: 'L',
				stopId: 'S',
				dockEnter: false,
			})
		).toEqual({
			job: 'vehicleHop',
			type: 'work',
			vehicleUid: 'v1',
			lineId: 'L',
			stopId: 'S',
			dockEnter: false,
		})
	})

	it('goWorkLocalsFromExecutionState reads jobPlan and path length', () => {
		const state: ExecutionState = {
			stack: [
				{
					scope: {
						variables: {
							jobPlan: { job: 'vehicleHop', vehicleUid: 'u', lineId: 'a', stopId: 'b' },
							path: [
								{ q: 0, r: 0 },
								{ q: 1, r: 0 },
							],
						},
						parent: undefined,
					},
					ip: { indexes: [0], functionIndex: undefined },
					loopScopes: [],
				},
			],
			plans: [],
		}
		expect(goWorkLocalsFromExecutionState(state)).toEqual({
			jobPlan: { job: 'vehicleHop', vehicleUid: 'u', lineId: 'a', stopId: 'b' },
			pathLen: 2,
		})
		expect(goWorkLocalsFromExecutionState(undefined)).toBeUndefined()
	})
})
