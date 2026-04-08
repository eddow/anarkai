import { describe, expect, it } from 'vitest'
import type { BiomeHint, TileField } from '../../terrain/src'
import {
	biomeTextureSpec,
	terrainTextureSpec,
	terrainTintForTile,
} from './terrain-visual-helpers'

describe('continuous terrain helpers', () => {
	it('maps biomes to the shared terrain texture set', () => {
		const cases: Array<[BiomeHint, string]> = [
			['ocean', 'terrain.water'],
			['lake', 'terrain.water'],
			['river-bank', 'terrain.grass'],
			['wetland', 'terrain.grass'],
			['grass', 'terrain.grass'],
			['forest', 'terrain.forest'],
			['sand', 'terrain.sand'],
			['rocky', 'terrain.stone'],
			['snow', 'terrain.snow'],
		]

		for (const [biome, expected] of cases) {
			expect(biomeTextureSpec(biome)).toBe(expected)
		}
	})

	it('uses the base texture tint for streamed terrain tiles', () => {
		const tile: TileField = {
			height: 10,
			temperature: 0,
			humidity: 0,
			sediment: 0,
			waterTable: 0,
		}

		expect(terrainTintForTile('snow', tile)).toBe(0xffffff)
	})

	it('prefers explicit concrete terrain over biome-derived textures', () => {
		expect(terrainTextureSpec('concrete', 'grass')).toBe('terrain.concrete')
		expect(terrainTextureSpec(undefined, 'grass')).toBe('terrain.grass')
	})
})
