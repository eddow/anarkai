/**
 * Spontaneous district spawning — the single source of truth for residential /
 * commercial spawner cadence. Seeded into `Game.districtSpawning` (reactive) so
 * it is tunable live by the player and tests. See `plans/spontaneous-construction-test.md`.
 */
export const districtSpawning = {
	/** Minimum seconds between automatic residential project spawn attempts. */
	residentialSpawnCooldownSeconds: 2,
	/** Minimum seconds between commercial shop spawn evaluations. */
	commercialSpawnCooldownSeconds: 2,
	/**
	 * Net positive-observation evidence required to commit a shop. Each pass with
	 * ≥1 shopper adds 1, each pass with none subtracts 1 (clamped to `[0, threshold]`).
	 */
	commercialObservationThreshold: 3,
	/** Axial distance for housing pressure vs capacity when evaluating a candidate residential tile. */
	residentialHousingDemandRadius: 12,
	/** Axial distance a candidate shop tile senses shoppers across. */
	commercialShopSensingRadius: 12,
} as const
