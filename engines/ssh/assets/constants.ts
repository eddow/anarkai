// Gameplay mechanics constants
// These control character behavior, survival mechanics, and game balance

/** Bounded need update: move `value` toward `target` (±1) with given `strength`. */
export function needUpdate(value: number, target: 1 | -1, strength: number): number {
	return target + (value - target) * Math.exp(-strength)
}

/**
 * Apply an activity-specific need rate over `dt` seconds.
 * Positive rate → drift toward +1 (worsening).
 * Negative rate → drift toward −1 (recovery).
 */
export function applyNeedRate(value: number, rate: number, dt: number): number {
	if (rate === 0) return value
	const target: 1 | -1 = rate > 0 ? 1 : -1
	return needUpdate(value, target, Math.abs(rate) * dt)
}

export const characterEvolutionRates: {
	[k in Ssh.NeedType]: Partial<Record<Ssh.ActivityType, number>> & {
		'*': number
	}
} = {
	hunger: {
		'*': 0.006,
		walk: 0.008,
		work: 0.012,
		eat: 0,
		rest: 0.004,
	},
	// Long-horizon sleep pressure (~6–20 in-game hours at 1:1 virtual time to move from rested
	// toward noticeable tiredness; tune with playtests). Much slower than hunger/fatigue.
	tiredness: {
		'*': 0.00002,
		walk: 0.000026,
		work: 0.000032,
		rest: 0.000014,
		eat: 0,
	},
	// Fatigue = short-term "need a pause / amusement / coffee break" — should rise faster than hunger/tiredness.
	// Walking must not count as recovery (old negative walk rate pinned fatigue near −1 during wander loops).
	fatigue: {
		'*': 0.028,
		walk: 0.012,
		work: 0.045,
		eat: 0,
		rest: -0.014,
	},
}

export const characterTriggerLevels = {
	hunger: {
		high: 0.5,
		critical: 0.8,
		satisfied: 0.15,
	},
	tiredness: {
		high: 0.5,
		critical: 0.8,
		satisfied: 0.1,
	},
	fatigue: {
		high: 0.5,
		critical: 0.7,
		satisfied: 0.1,
	},
} as const

export const activityDurations = {
	handTransfer: 1, // Time to grab/drop items by hand
	footWalkTime: 1, // Time to walk by foot
	eating: 2, // Time to eat food
	restMin: 3,
	restMax: 6,
} as const

/** Continuous recovery rates while standing on a reserved residential tile (all toward −1). */
export const residentialRecoveryRates = {
	hunger: 0.008,
	fatigue: 0.01,
	// Stronger than baseline tiredness drift so a residential visit meaningfully pays down sleep debt.
	tiredness: 0.012,
} as const

export const maxWalkTime = 24 // Maximum walking time accepted to choose a tile for an action

// Storage and building constants
export const transformAlveolusStorageMultiplier = 3 // Transform alveoli can store input goods * this multiplier
// Storage buffer sizes for transform/harvest
export const inputBufferSize = 2
export const outputBufferSize = 3
