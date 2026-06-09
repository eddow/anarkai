export { alveoli } from './content/alveoli'
export { commerce } from './content/commerce'
export { configurations } from './content/configurations'
export { construction } from './content/construction'
export { deposits } from './content/deposits'
export {
	freightLineHiveNeedPriorityWeight,
	freightLineUtilityWeights,
} from './content/freight-line-utility'
export { goods } from './content/goods'
export { jobBalance } from './content/job-balance'
export { settlementTrade } from './content/settlement-trade'
export { settlementZones } from './content/settlement-zones'
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
