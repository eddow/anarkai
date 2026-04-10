import { Container, RenderLayer, Texture } from 'pixi.js'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { Tile } from 'ssh/board/tile'
import { axial } from 'ssh/utils'
import { describe, expect, it, vi } from 'vitest'
import type { RenderableTerrainTile } from 'ssh/game/game'
import type { TerrainType } from 'ssh/types'
import type { BiomeHint, TileField } from '../../terrain/src'
import { TerrainVisual } from './continuous-terrain'
import {
	biomeTextureSpec,
	terrainTextureSpec,
	terrainTintForTile,
} from './terrain-visual-helpers'
import type { PixiGameRenderer } from './renderer'

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
			terrainType: 0,
			rockyNoise: 0,
			sediment: 0,
			waterTable: 0,
		}

		expect(terrainTintForTile('snow', tile)).toBe(0xffffff)
	})

	it('prefers explicit concrete terrain over biome-derived textures', () => {
		expect(terrainTextureSpec('concrete', 'grass')).toBe('terrain.concrete')
		expect(terrainTextureSpec('rocky', 'grass')).toBe('terrain.stone')
		expect(terrainTextureSpec('snow', 'grass')).toBe('terrain.snow')
		expect(terrainTextureSpec(undefined, 'grass')).toBe('terrain.grass')
	})

	it('requests gameplay frontier expansion for visible missing tiles', async () => {
		let materialized = false
		let requestCount = 0
		const requestedRadii: number[] = []
		const requestGameplayFrontier = vi.fn(async () => {
			requestCount++
			if (requestCount > 1) {
				throw new Error('frontier request should not recurse synchronously')
			}
			materialized = true
			return true
		})
		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: () => materialized,
			getRenderableTerrainAt: () => (materialized ? { terrain: 'grass', height: 0 } : undefined),
			requestGameplayFrontier: async (center, radius, options) => {
				requestedRadii.push(radius)
				return requestGameplayFrontier()
			},
		})

		const visual = new TerrainVisual(renderer)
		;(visual as any).refresh()
		await Promise.resolve()
		await Promise.resolve()
		await Promise.resolve()

		expect(requestGameplayFrontier).toHaveBeenCalledTimes(1)
		expect(requestedRadii).toEqual([16])
	})

	it('does not keep invalidating when a frontier request materializes nothing', async () => {
		const requestGameplayFrontier = vi.fn(async () => false)
		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: () => false,
			getRenderableTerrainAt: () => undefined,
			requestGameplayFrontier,
		})

		const visual = new TerrainVisual(renderer)
		;(visual as any).refresh()
		await Promise.resolve()
		await Promise.resolve()
		await Promise.resolve()

		expect(requestGameplayFrontier).toHaveBeenCalledTimes(1)
	})

	it('materializes the corridor between three adjacent sector centers', async () => {
		const materialized = new Set<string>()
		const requestResults: boolean[] = []
		const requestGameplayFrontier = vi.fn(async (center: { q: number; r: number }, radius: number) => {
			let generated = false
			for (const coord of axial.allTiles(center, radius)) {
				const key = axial.key(coord)
				if (materialized.has(key)) continue
				materialized.add(key)
				generated = true
			}
			requestResults.push(generated)
			return generated
		})
		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: (coord) => materialized.has(axial.key(coord)),
			getRenderableTerrainAt: (coord) =>
				materialized.has(axial.key(coord)) ? { terrain: 'grass', height: 0 } : undefined,
			requestGameplayFrontier,
		})

		const visual = new TerrainVisual(renderer)
		for (const sectorQ of [-1, 0, 1]) {
			await (visual as any).requestSectorFrontier({
				key: `${sectorQ},0`,
				sectorQ,
				sectorR: 0,
				distanceToCenter: Math.abs(sectorQ),
			})
		}

		expect(requestGameplayFrontier).toHaveBeenCalledTimes(3)
		expect(requestResults).toEqual([true, true, true])

		for (let q = -9; q <= 25; q++) {
			expect(materialized.has(axial.key({ q, r: 8 }))).toBe(true)
		}
	})

	it('renders authoritative SSH terrain without a local generator snapshot', () => {
		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: () => true,
			getRenderableTerrainAt: () => ({ terrain: 'rocky', height: 0.25 }),
			requestGameplayFrontier: vi.fn(async () => false),
		})

		const visual = new TerrainVisual(renderer)
		;(visual as any).refresh()

		const diagnostics = visual.getDiagnostics()
		expect(diagnostics.refresh.materializedVisibleTileCount).toBeGreaterThan(0)
		expect(diagnostics.totals.groundTextureGroupRenderables).toBeGreaterThan(0)
		expect(diagnostics.refresh.queuedVisibleSectorCount).toBe(0)
	})

	it('batches static resource sprites per sector without tile visuals', () => {
		const content = Object.create(UnBuiltLand.prototype) as UnBuiltLand
		const depositTile = {
			position: { q: 0, r: 0 },
			content,
		}
		content.tile = depositTile as any
		content.deposit = { amount: 2, name: 'rock' } as any

		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: () => true,
			getRenderableTerrainAt: () => ({ terrain: 'grass', height: 0 }),
			requestGameplayFrontier: vi.fn(async () => false),
			hex: {
				getTile: (coord: { q: number; r: number }) =>
					coord.q === 0 && coord.r === 0 ? (depositTile as any) : undefined,
			},
		})

		const visual = new TerrainVisual(renderer)
		;(visual as any).refresh()

		const diagnostics = visual.getDiagnostics()
		expect(diagnostics.totals.resourceBatchCount).toBeGreaterThan(0)
		expect(diagnostics.totals.staticResourceSpriteCount).toBeGreaterThan(0)
		expect(renderer.layers.resources.renderLayerChildren.length).toBeGreaterThan(0)
	})
})

function createTerrainRendererStub(gameOverrides: {
	hasRenderableTerrainAt(coord: { q: number; r: number }): boolean
	getRenderableTerrainAt(coord: { q: number; r: number }): RenderableTerrainTile | undefined
	hex?: {
		getTile?(coord: { q: number; r: number }): unknown
	}
	requestGameplayFrontier(
		center: { q: number; r: number },
		radius: number,
		options: { maxBatchSize: number }
	): Promise<boolean>
}): PixiGameRenderer {
	return {
		game: gameOverrides,
		app: {
			screen: { width: 240, height: 180 },
			renderer: {
				textureGenerator: {
					generateTexture() {
						return Texture.WHITE
					},
				},
			},
		},
		world: {
			scale: { x: 1, y: 1 },
			toLocal(point: { x: number; y: number }) {
				return point
			},
		},
		worldScene: new Container(),
		layers: {
			ground: new RenderLayer(),
			alveoli: new RenderLayer(),
			resources: new RenderLayer(),
			storedGoods: new RenderLayer(),
			looseGoods: new RenderLayer(),
			characters: new RenderLayer(),
			ui: new Container(),
		},
		attachToLayer(layer: RenderLayer, child: Container) {
			layer.attach(child)
		},
		detachFromLayer(layer: RenderLayer, child: Container) {
			layer.detach(child)
		},
		getTexture(spec: string) {
			expect(spec.startsWith('terrain.') || spec.startsWith('objects.')).toBe(true)
			return Texture.WHITE
		},
	} as unknown as PixiGameRenderer
}
