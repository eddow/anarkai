/** Extra ring of tiles around requested coords for streamed hydrology. */
export const streamHydrologyPadding = 4

/** Default tile walk time after terrain → board materialization. */
export const boardDefaultTileWalkTime = 3

/** Loose goods equilibrium spread around analytic equilibrium. */
export const boardGoodsEquilibriumVariance = 0.3

/** Multiplier for infinite-half-life goods at board generation equilibrium. */
export const boardInfiniteHalfLifeEquilibriumMultiplier = 10

/** Max random ambient loose goods per terrain ambient good type at gen. */
export const boardAmbientGoodsMaxPerType = 3

/** Deposit fill level uses `(1 + rnd * depositFillRandomSpread) * maxAmount / depositFillDivisor`. */
export const boardDepositFillRandomSpread = 2
export const boardDepositFillDivisor = 3

/** Population spawn annulus defaults (axial distance from origin). */
export const populationSpawnMinRadiusFromOrigin = 2
export const populationSpawnMaxRadius = 5

/** Minimum bootstrap radius when resolving gameplay coords from characterRadius. */
export const gameplayBootstrapMinRadius = 2

/** Fallback axial radius when `characterRadius` is omitted during bootstrap. */
export const bootstrapCharacterRadiusFallback = 5

/**
 * Non-savegame defaults for headless/tests until new-game flow supplies save-owned options.
 * `terrainSeed` is owned by save state; do not treat as authored rule data.
 */
export const defaultNewGameCharacterCount = 1
export const defaultNewGameCharacterRadius = 200
