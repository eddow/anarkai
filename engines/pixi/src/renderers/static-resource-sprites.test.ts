import type { Texture } from 'pixi.js'
import type { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import {
	plantedTreeImmatureAgeSeconds,
	plantedTreeMatureAgeSeconds,
} from 'ssh/board/content/unbuilt-land'
import type { TerrainSample } from 'ssh/game/terrain-provider'
import { describe, expect, it } from 'vitest'
import {
	buildStaticResourceSpriteSpecs,
	buildStaticResourceSpriteSpecsFromTerrainSample,
} from './static-resource-sprites'

function resolveTexture(): Texture {
	return {
		width: 128,
		height: 256,
	} as unknown as Texture
}

function buildTreeSample(amount: number): TerrainSample {
	return {
		terrain: 'forest',
		deposit: {
			type: 'tree',
			name: 'tree',
			amount,
			maxAmount: 12,
		},
	}
}

describe('buildStaticResourceSpriteSpecsFromTerrainSample', () => {
	it('keeps surviving deposit sprites identical when one deposit is removed', () => {
		const coord = { q: 7, r: -3 }
		const resolve = () => resolveTexture()
		const four = buildStaticResourceSpriteSpecsFromTerrainSample(coord, buildTreeSample(4), resolve)
		const three = buildStaticResourceSpriteSpecsFromTerrainSample(
			coord,
			buildTreeSample(3),
			resolve
		)

		expect(four).toHaveLength(4)
		expect(three).toHaveLength(3)
		expect(three).toEqual(four.slice(0, 3))
	})

	it('does not enlarge the last remaining sprite on the tile', () => {
		const coord = { q: -2, r: 5 }
		const resolve = () => resolveTexture()
		const twelve = buildStaticResourceSpriteSpecsFromTerrainSample(
			coord,
			buildTreeSample(12),
			resolve
		)
		const one = buildStaticResourceSpriteSpecsFromTerrainSample(coord, buildTreeSample(1), resolve)

		expect(one).toHaveLength(1)
		expect(one[0]).toEqual(twelve[0])
	})

	it('renders one planted tree sprite per deposit amount', () => {
		const content = {
			tile: { position: { q: 0, r: 0 } },
			deposit: { name: 'tree', amount: 2, maxAmount: 12 },
			plantedTrees: { ages: [0, plantedTreeMatureAgeSeconds] },
		} as unknown as UnBuiltLand

		const specs = buildStaticResourceSpriteSpecs(content, resolveTexture)
		expect(specs).toHaveLength(2)
	})

	it('uses planted tree age to choose growth-stage sprites', () => {
		const small = {
			tile: { position: { q: 0, r: 0 } },
			deposit: { name: 'tree', amount: 1, maxAmount: 12 },
			plantedTrees: { ages: [0] },
		} as unknown as UnBuiltLand
		const medium = {
			tile: { position: { q: 0, r: 0 } },
			deposit: { name: 'tree', amount: 1, maxAmount: 12 },
			plantedTrees: { ages: [plantedTreeImmatureAgeSeconds] },
		} as unknown as UnBuiltLand
		const mature = {
			tile: { position: { q: 0, r: 0 } },
			deposit: { name: 'tree', amount: 1, maxAmount: 12 },
			plantedTrees: { ages: [plantedTreeMatureAgeSeconds] },
		} as unknown as UnBuiltLand

		expect(buildStaticResourceSpriteSpecs(small, resolveTexture)[0]?.textureKey).toMatch(
			/tree[1-4]$/
		)
		expect(buildStaticResourceSpriteSpecs(medium, resolveTexture)[0]?.textureKey).toMatch(
			/tree[5-8]$/
		)
		expect(buildStaticResourceSpriteSpecs(mature, resolveTexture)[0]?.textureKey).toMatch(
			/tree(9|10|11)$/
		)
	})
})
