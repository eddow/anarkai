import type { BiomeHint, TileField } from '../../terrain/src'

export type TerrainTextureOverride =
	| 'water'
	| 'sand'
	| 'grass'
	| 'forest'
	| 'rocky'
	| 'snow'
	| 'concrete'
	| undefined

export function biomeTextureSpec(biome: BiomeHint): string {
	switch (biome) {
		case 'ocean':
		case 'lake':
			return 'terrain.water'
		case 'river-bank':
		case 'wetland':
		case 'grass':
			return 'terrain.grass'
		case 'forest':
			return 'terrain.forest'
		case 'sand':
			return 'terrain.sand'
		case 'rocky':
			return 'terrain.stone'
		case 'snow':
			return 'terrain.snow'
	}
}

export function terrainTextureSpec(
	terrain: TerrainTextureOverride,
	biome: BiomeHint
): string {
	if (terrain === 'concrete') return 'terrain.concrete'
	return biomeTextureSpec(biome)
}

export function terrainTintForTile(_biome: BiomeHint, _tile: TileField): number {
	return 0xffffff
}
