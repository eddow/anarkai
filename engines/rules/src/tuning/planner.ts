import { activityDurations } from './characters'

/** Tunable weights for projected-discomfort scoring (not final balance). */
export const activityUtilityConfig = {
	hungerPos: 4,
	hungerNeg: 1,
	fatiguePos: 3,
	fatigueNeg: 1,
	tirednessPos: 3,
	tirednessNeg: 1,
	exponent: 2,
	/** Penalty per simulated second of activity (travel + dwell). */
	timeCostPerSecond: 0.08,
	/** Rough work segment for projection when real duration is unknown. */
	workHorizonSeconds: 8,
	/** Midpoint of restMin/restMax for wander/home ponder. */
	wanderRestSeconds: (activityDurations.restMin + activityDurations.restMax) / 2,
	/** Prefer previous pick if within this utility gap (reduces thrash). */
	hysteresis: 0.03,
	/**
	 * Added to `bestWork` / `assignedWork` utility when keepWorking is true.
	 * Tune with playtests.
	 */
	workPreferenceWhenFit: 0.55,
} as const
