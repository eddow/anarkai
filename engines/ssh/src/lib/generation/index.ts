/**
 * Main generation system entry point
 * Coordinates all generation activities for the game
 */

import { streamHydrologyPadding } from 'engine-rules'
import {
	type BiomeHint,
	generateHydratedRegion as generateTerrainRegion,
	generateHydratedRegionAsync as generateTerrainRegionAsync,
	type TileOverride,
} from 'engine-terrain'
import type { TerrainType } from 'ssh/types'
import type { AxialCoord } from 'ssh/utils'
import { BoardGenerator, type GeneratedTileData } from './board'

export interface GameGenerationConfig {
	terrainSeed: number
	characterCount: number
	characterRadius?: number
}

export interface TerrainTerraformPatch {
	coord: [number, number]
	height?: number
	temperature?: number
	humidity?: number
	sediment?: number
	waterTable?: number
	terrain?: TerrainType
}

const terrainToBiome: Partial<Record<TerrainType, BiomeHint>> = {
	water: 'lake',
	sand: 'sand',
	grass: 'grass',
	forest: 'forest',
	rocky: 'rocky',
	snow: 'snow',
}
function toTileOverrides(terraforming: TerrainTerraformPatch[]): TileOverride[] {
	const overrides: TileOverride[] = []
	for (const patch of terraforming) {
		const tilePatch: TileOverride['tile'] = {}
		if (patch.height !== undefined) tilePatch.height = patch.height
		if (patch.temperature !== undefined) tilePatch.temperature = patch.temperature
		if (patch.humidity !== undefined) tilePatch.humidity = patch.humidity
		if (patch.sediment !== undefined) tilePatch.sediment = patch.sediment
		if (patch.waterTable !== undefined) tilePatch.waterTable = patch.waterTable

		overrides.push({
			coord: { q: patch.coord[0], r: patch.coord[1] },
			tile: Object.keys(tilePatch).length > 0 ? tilePatch : undefined,
			biome: patch.terrain ? terrainToBiome[patch.terrain] : undefined,
		})
	}
	return overrides
}

export class GameGenerator {
	generateRegion(
		config: GameGenerationConfig,
		coords: Iterable<AxialCoord>,
		terraforming: TerrainTerraformPatch[] = []
	): GeneratedTileData[] {
		const snapshot = generateTerrainRegion(config.terrainSeed, coords, {
			hydrologyPadding: streamHydrologyPadding,
			tileOverrides: toTileOverrides(terraforming),
		})

		const boardGenerator = new BoardGenerator()
		return boardGenerator.generateBoard(snapshot)
	}

	async generateRegionAsync(
		config: GameGenerationConfig,
		coords: Iterable<AxialCoord>,
		terraforming: TerrainTerraformPatch[] = []
	): Promise<GeneratedTileData[]> {
		const snapshot = await generateTerrainRegionAsync(config.terrainSeed, coords, {
			fieldBackend: 'auto',
			hydrologyPadding: streamHydrologyPadding,
			tileOverrides: toTileOverrides(terraforming),
		})

		const boardGenerator = new BoardGenerator()
		return boardGenerator.generateBoard(snapshot)
	}
}

export { BoardGenerator, type GeneratedTileData } from './board'
export { type GeneratedCharacterData, PopulationGenerator } from './population'
