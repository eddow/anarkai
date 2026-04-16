export { alveoli } from './content/alveoli'
export { configurations } from './content/configurations'
export { deposits } from './content/deposits'
export {
	freightLineHiveNeedPriorityWeight,
	freightLineUtilityWeights,
} from './content/freight-line-utility'
export { goods } from './content/goods'
export { jobBalance } from './content/job-balance'
export { terrain } from './content/terrain'
export { offloadRange, vehicles } from './content/vehicles'

export {
	activityDurations,
	characterEvolutionRates,
	characterTriggerLevels,
	inputBufferSize,
	maxWalkTime,
	outputBufferSize,
	residentialRecoveryRates,
	transformAlveolusStorageMultiplier,
} from './tuning/characters'
export {
	defaultGatherFreightRadius,
	gatherFreightBayStorageCapacityPerSlot,
	gatherFreightBayStorageSlots,
	gatherTargetBatchSize,
	harvestFatiguePremium,
	harvestNpcSearchDistance,
	harvestTravelFatiguePerStep,
	waitForIncomingGoodsPollSeconds,
} from './tuning/jobs'
export { activityUtilityConfig } from './tuning/planner'
export { gameMaxTickDeltaSeconds, gameRootSpeed, gameTimeSpeedFactors } from './tuning/simulation'

export { defaultBiomeClassificationThresholds } from './world/biome-classification'
export {
	boardAmbientGoodsMaxPerType,
	boardDefaultTileWalkTime,
	boardDepositFillDivisor,
	boardDepositFillRandomSpread,
	boardGoodsEquilibriumVariance,
	boardInfiniteHalfLifeEquilibriumMultiplier,
	bootstrapCharacterRadiusFallback,
	defaultNewGameCharacterCount,
	defaultNewGameCharacterRadius,
	gameplayBootstrapMinRadius,
	populationSpawnMaxRadius,
	populationSpawnMinRadiusFromOrigin,
	streamHydrologyPadding,
} from './world/bootstrap'
export { defaultHydrologyTraceConstants } from './world/hydrology-trace'
export { defaultTerrainConfig } from './world/terrain-defaults'
