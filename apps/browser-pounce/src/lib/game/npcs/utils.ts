import { match } from 'arktype'
import { unreactive } from 'mutts'
import {
	type IsaTypes,
	jsIsaTypes,
	jsOperators,
	MiniScriptExecutor,
	NpcScript,
	type Operators,
} from 'npc-script/src'
import { axial, epsilon } from '$lib/utils'
import {
	Position,
	Positioned,
	positionLerp,
	positionRoughlyEquals,
	toAxialCoord,
} from '../../utils/position'

const equals = match({})
	.case([Positioned, Positioned], ([left, right]) => positionRoughlyEquals(left, right))
	.case(['number', 'number'], ([left, right]) => Math.abs(left - right) < epsilon)
	.case(['unknown', 'unknown'], ([left, right]) => jsOperators['=='](left, right))
	.default('assert')

const subtract = match({})
	.case([Positioned, Positioned], ([left, right]) =>
		axial.linear(toAxialCoord(left), [-1, toAxialCoord(right)]),
	)
	.case(['unknown', 'unknown'], ([left, right]) => jsOperators['-'](left, right))
	.default('assert')
const add = match({})
	.case([Positioned, Positioned], ([left, right]) =>
		axial.linear(toAxialCoord(left), toAxialCoord(right)),
	)
	.case(['unknown', 'unknown'], ([left, right]) => jsOperators['+'](left, right))
	.default('assert')

const multiply = match({})
	.case([Positioned, 'number'], ([left, right]) => axial.linear([right, toAxialCoord(left)]))
	.case(['number', Positioned], ([left, right]) => axial.linear([left, toAxialCoord(right)]))
	.case(['unknown', 'unknown'], ([left, right]) => jsOperators['*'](left, right))
	.default('assert')
const divide = match({})
	.case([Positioned, 'number'], ([left, right]) => axial.linear([1 / right, toAxialCoord(left)]))
	.case(['unknown', 'unknown'], ([left, right]) => jsOperators['/'](left, right))
	.default('assert')

unreactive(MiniScriptExecutor)
unreactive(NpcScript)
/**
 * Custom operators that extend JavaScript operators with position support
 */
export const gameOperators: Operators = Object.setPrototypeOf(
	{
		'==': (left: any, right: any) => equals([left, right]),
		'!=': (left: any, right: any) => !equals([left, right]),
		'-': (left: any, right: any) => subtract([left, right]),
		'+': (left: any, right: any) => add([left, right]),
		'*': (left: any, right: any) => multiply([left, right]),
		'/': (left: any, right: any) => divide([left, right]),
	},
	jsOperators,
)

/**
 * Custom isa types that extend JavaScript isa types with position support
 */
export const gameIsaTypes: IsaTypes = Object.setPrototypeOf(
	{
		position: (_value: any) => Position.infer,
	},
	jsIsaTypes,
)
// Math utilities

export function lerp<T extends number | Positioned>(a: T, b: T, t: number): T {
	if (typeof a === 'number' && typeof b === 'number') {
		return (a + (b - a) * t) as T
	}
	if (Positioned.allows(a) && Positioned.allows(b)) {
		return positionLerp(a, b, t) as T
	}
	throw new Error(`Invalid lerp types: ${typeof a} and ${typeof b}`)
}
