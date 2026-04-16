/**
 * Tunable weights for freight line relevance / begin-service scoring (not wired to runtime yet).
 *
 * Distance and travel time subtract from the cargo score; staleness adds a fairness bonus.
 */
export const freightLineUtilityWeights = {
	/** Multiplier for {@link computeFreightLineSegmentUtility}'s `travelDistance` (hex steps or world units). */
	distance: 0.02,
	/** Multiplier for travel time (seconds or abstract time units). */
	travelTime: 0.01,
	/** Multiplier for staleness (caller's units; often normalized 0..1). */
	staleness: 0.15,
} as const

/**
 * Scales hive need sink quantities by demand priority (`2-use` vs `1-buffer`).
 * `0-store` is excluded from aggregated hive needs and is not used here.
 */
export const freightLineHiveNeedPriorityWeight = {
	'2-use': 1,
	'1-buffer': 0.5,
} as const

export type FreightLineUtilityWeights = typeof freightLineUtilityWeights
