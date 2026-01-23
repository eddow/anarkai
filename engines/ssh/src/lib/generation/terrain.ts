/**
 * Terrain generation utilities
 * Extracted from hex/perlin-terrain.ts for better organization
 */

import type { TerrainType } from 'ssh/src/lib/types'
import type { AxialCoord } from 'ssh/src/lib/utils'
import { PerlinTerrainGenerator } from './perlin-terrain'

export interface TerrainGenerationConfig {
	seed: number
	config?: any // PerlinTerrainGenerator config
}

export class TerrainGenerator {
	private generator: PerlinTerrainGenerator

	constructor(config: TerrainGenerationConfig) {
		this.generator = new PerlinTerrainGenerator(config.seed)
	}

	generateTerrain(coord: AxialCoord): TerrainType {
		return this.generator.generateTerrain(coord)
	}

	generateHeightMap(coord: AxialCoord): number {
		return this.generator.generateHeightMap(coord)
	}

	generateBiomeData(coord: AxialCoord) {
		return this.generator.generateBiomeData(coord)
	}
}
