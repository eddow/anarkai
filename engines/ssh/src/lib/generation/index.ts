/**
 * Main generation system entry point
 * Coordinates all generation activities for the game
 */

import { BoardGenerator, type GeneratedTileData } from './board'
import { type GeneratedCharacterData, PopulationGenerator } from './population'

export interface GameGenerationConfig {
	boardSize: number
	terrainSeed: number
	characterCount: number
	characterRadius?: number
}

export interface GameGenerationResult {
	boardData: GeneratedTileData[]
	populationData: GeneratedCharacterData[]
}

export class GameGenerator {
	/**
	 * Generate the entire game world (synchronous)
	 */
	generate(config: GameGenerationConfig): GameGenerationResult {
		// Generate board data
		const boardGenerator = new BoardGenerator({
			boardSize: config.boardSize,
			terrainSeed: config.terrainSeed,
		})
		const boardData = boardGenerator.generateBoard()

		// Generate population data
		const populationGenerator = new PopulationGenerator()
		const populationData = populationGenerator.generateCharacters(
			{
				characterCount: config.characterCount,
				radius: config.characterRadius,
				boardSize: config.boardSize,
			},
			boardData,
		)

		return {
			boardData,
			populationData,
		}
	}
}

// Export individual generators for direct use if needed
export { BoardGenerator, type GeneratedTileData } from './board'
export { type GeneratedCharacterData, PopulationGenerator } from './population'
export { TerrainGenerator } from './terrain'
