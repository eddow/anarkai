export const characterEvolutionRates = {
	hunger: {
		factor: 0.001,
		'*': 6,
		walk: 8,
		work: 12,
		eat: 0,
		rest: 4,
	},
	// Long-horizon sleep pressure (~6–20 in-game hours at 1:1 virtual time to move from rested
	// toward noticeable tiredness; tune with playtests). Much slower than hunger/fatigue.
	tiredness: {
		factor: 0.00001,
		'*': 2,
		walk: 2.6,
		work: 3.2,
		rest: 1.4,
		eat: 0,
	},
	// Fatigue = short-term "need a pause / amusement / coffee break" — should rise faster than hunger/tiredness.
	// Walking must not count as recovery (old negative walk rate pinned fatigue near −1 during wander loops).
	fatigue: {
		factor: 0.001,
		'*': 28,
		walk: 12,
		work: 45,
		eat: 0,
		rest: -14,
	},
} as const

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

/** Maximum walking time accepted to choose a tile for an action */
export const maxWalkTime = 24

/**
 * Local perception radius, in axial tiles, within which a character *senses* opportunities for any
 * self-directed action — work, shelter, food, entertainment, buying. This is the "last mile": a
 * character only ever considers nearby options; long-range logistics ride the goods/transport chain.
 *
 * It bounds the candidate *enumeration* (a `tilesAround` scan of O(R²) tiles), so it must stay a small
 * constant — raise it back toward `maxWalkTime` and the per-decision scan explodes. It is deliberately
 * **not** tied to the number of jobs: enumerating by job count would be unbounded as a settlement grows.
 *
 * Distinct from {@link maxWalkTime}, which caps the *walk* budget of a committed action (the real path
 * can be longer than the axial sight distance due to rivers/roads/blocking).
 */
export const sensingRadius = 8

/**
 * Minimum *game-time* (virtual) seconds between consecutive idle-worker re-plans triggered by
 * {@link wakeWanderingWorkersNear}. When goods move, a wandering/pondering worker is re-planned to
 * check for newly-available work; this throttle collapses the re-plan cascade (many movement events →
 * many `findAction()` calls per frame) into one reconsideration per window.
 *
 * Keyed on {@link Clock.virtualTime} (simulation time), **not** wall-clock, so game-speed settings do
 * not change behaviour: a worker reconsiders at most once per this many *simulated* seconds regardless
 * of 1× / 4× / fast-forward. This is the Phase-4 "commitment" throttle — an idle worker who just
 * decided does not re-decide every tick.
 */
export const idleReplanIntervalSeconds = 0.5

export const transformAlveolusStorageMultiplier = 3 // Transform alveoli can store input goods * this multiplier
export const inputBufferSize = 2
export const outputBufferSize = 3
