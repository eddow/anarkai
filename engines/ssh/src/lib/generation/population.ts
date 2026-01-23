/**
 * Population generation logic
 * Extracted from population/index.ts for better organization
 */

import type { AxialCoord } from '$lib/utils'
import { axial } from '$lib/utils'
import { AxialSet } from '$lib/utils/mem'

export interface PopulationGenerationConfig {
	characterCount: number
	radius?: number
	boardSize: number
	minRadiusFromOrigin?: number
}

export interface GeneratedCharacterData {
	name: string
	coord: AxialCoord
}

export class PopulationGenerator {
	generateCharacters(
		config: PopulationGenerationConfig,
		tileData: any[],
	): GeneratedCharacterData[] {
		const used = new AxialSet()
		const characters: GeneratedCharacterData[] = []

		// Recover original behavior: iteratively pick nearest fitting tiles around (0,0)
		const origin = { q: 0, r: 0 }
		const minR = config.minRadiusFromOrigin ?? 2
		const maxR = config.radius ?? 5

		// Precompute eligible tiles with their distance to origin
		const eligible = tileData
			.filter((t) => {
				const d = axial.distance(t.coord, origin)
				return t.terrain !== 'water' /*&& !t.deposit*/ && d >= minR && d <= maxR
			})
			.map((t) => ({ tile: t, d: axial.distance(t.coord, origin) }))
			.sort((a, b) => a.d - b.d)

		for (let i = 0; i < config.characterCount && eligible.length > 0; i++) {
			// Pick nearest not-yet-used tile each time
			const idx = eligible.findIndex((e) => !used.has(e.tile.coord))
			if (idx === -1) break
			const { tile } = eligible[idx]
			characters.push({ name: `Character ${i}`, coord: tile.coord })
			used.add(tile.coord)
		}

		return characters
	}
}
