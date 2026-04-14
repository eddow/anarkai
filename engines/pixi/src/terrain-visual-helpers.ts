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

export function terrainTextureSpec(terrain: TerrainTextureOverride, biome: BiomeHint): string {
	switch (terrain) {
		case 'concrete':
			return 'terrain.concrete'
		case 'water':
			return 'terrain.water'
		case 'sand':
			return 'terrain.sand'
		case 'grass':
			return 'terrain.grass'
		case 'forest':
			return 'terrain.forest'
		case 'rocky':
			return 'terrain.stone'
		case 'snow':
			return 'terrain.snow'
	}
	return biomeTextureSpec(biome)
}

export function terrainTintForTile(_biome?: BiomeHint, _tile?: TileField): number {
	return 0xffffff
}
