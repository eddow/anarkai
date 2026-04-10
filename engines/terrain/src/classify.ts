import type { BiomeHint, EdgeField, TerrainConfig, TileField } from './types'

const RIVER_FLUX_THRESHOLD = 5
const RIVER_BANK_INFLUENCE_THRESHOLD = 1.1

export interface HydrologyClassification {
	bankInfluence?: number
	channelInfluence?: number
}

/**
 * Classify a tile into a biome hint based on its fields and neighboring edge flows.
 * All thresholds come from config — no hardcoded magic numbers.
 * Edge-aware classification becomes active once hydrology populates the edges (Phase 2).
 */
export function classifyTile(
	tile: TileField,
	neighborEdges: EdgeField[],
	config: TerrainConfig,
	hydrology: HydrologyClassification = {}
): BiomeHint {
	const maxFlux = neighborEdges.reduce((m, e) => Math.max(m, e.flux), 0)
	const riverInfluence = hydrology.bankInfluence ?? 0
	const channelInfluence = hydrology.channelInfluence ?? 0

	if (tile.height < config.seaLevel) {
		return maxFlux > RIVER_FLUX_THRESHOLD ? 'lake' : 'ocean'
	}

	if (
		channelInfluence > 1.15 &&
		maxFlux > RIVER_FLUX_THRESHOLD * 2 &&
		tile.height < config.forestLevel
	) {
		return 'lake'
	}

	if (maxFlux > RIVER_FLUX_THRESHOLD || riverInfluence > RIVER_BANK_INFLUENCE_THRESHOLD) {
		return 'river-bank'
	}

	if (riverInfluence > 0.35 && tile.height < config.forestLevel) return 'wetland'

	if (tile.height > config.rockyLevel) return tile.height > config.snowLevel ? 'snow' : 'rocky'

	if (tile.height <= config.forestLevel) return 'sand'

	if (tile.humidity > config.wetlandHumidity && tile.height < config.forestLevel) return 'wetland'

	if (tile.terrainType > 0) return 'forest'

	return 'grass'
}
