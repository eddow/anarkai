export const MovementState = {
	idle: 'idle',
	tracked: 'tracked',
	claimed: 'claimed',
	delivering: 'delivering',
	completed: 'completed',
	aborted: 'aborted',
	suspended: 'suspended',
} as const

export type MovementState = (typeof MovementState)[keyof typeof MovementState]

export const MovementTransitions: Record<MovementState, MovementState[]> = {
	[MovementState.idle]: [MovementState.tracked, MovementState.aborted],
	[MovementState.tracked]: [
		MovementState.tracked,
		MovementState.claimed,
		MovementState.suspended,
		MovementState.aborted,
	],
	[MovementState.claimed]: [
		MovementState.tracked,
		MovementState.delivering,
		MovementState.suspended,
		MovementState.aborted,
	],
	[MovementState.delivering]: [MovementState.completed, MovementState.aborted],
	[MovementState.completed]: [],
	[MovementState.aborted]: [],
	[MovementState.suspended]: [
		MovementState.suspended,
		MovementState.tracked,
		MovementState.aborted,
	],
}

export class MovementStateError extends Error {
	constructor(
		public readonly from: MovementState,
		public readonly to: MovementState
	) {
		super(`Invalid movement transition: ${from} → ${to}`)
		this.name = 'MovementStateError'
	}
}

export function transitionMovement(state: MovementState, to: MovementState): MovementState {
	const allowed = MovementTransitions[state]
	if (!allowed.includes(to)) throw new MovementStateError(state, to)
	return to
}

export function isTerminalState(state: MovementState): boolean {
	return state === MovementState.completed || state === MovementState.aborted
}
