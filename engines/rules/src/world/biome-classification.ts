/** Thresholds for `classifyTile` (river-bank / lake / wetland vs land). */
export const defaultBiomeClassificationThresholds = {
	riverFluxThreshold: 5,
	riverBankInfluenceThreshold: 1.1,
	channelInfluenceLake: 1.15,
	riverFluxLakeMultiplier: 2,
	wetlandRiverInfluence: 0.35,
} as const
