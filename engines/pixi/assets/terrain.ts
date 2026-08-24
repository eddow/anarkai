import type { VisualDefinition } from 'engine-rules/visual-content'

/**
 * Terrain visual definitions (board backgrounds). Terrain textures remain a
 * pixi concern (large board-rendering jpgs); all other entity visuals live in
 * `engine-rules/visual-content`.
 */
export const terrain: Record<string, VisualDefinition> = {
	water: {}, // TODO: Add visual details
	forest: {},
	rocky: { background: 'terrain.stone' },
	grass: {},
	concrete: { background: 'terrain.concrete' }, // Inferred from Alveolus code
	sand: {},
	snow: {},
}
