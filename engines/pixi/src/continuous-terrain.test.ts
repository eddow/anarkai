import { Container, RenderLayer, Texture } from 'pixi.js'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { Tile } from 'ssh/board/tile'
import type { RenderableTerrainTile } from 'ssh/game/game'
import { axial, cartesian, fromCartesian, tileSize } from 'ssh/utils'
import { describe, expect, it, vi } from 'vitest'
import type { BiomeHint, TerrainMacroHydrologySnapshot, TileField } from '../../terrain/src'
import {
	macroRequestForTerrainLod,
	macroStepForTerrainLod,
	resolveTerrainLod,
	shouldRenderTerrainHoverForObject,
	TerrainVisual,
	terrainLodTilePixels,
} from './continuous-terrain'
import type { PixiGameRenderer } from './renderer'
import { collectRenderableTriangles } from './terrain-sector-baker'
import {
	computeSectorDisplayBounds,
	coordsForSectorBakeDomain,
	coordsForSectorInterior,
	sectorKeyForCoord,
	sectorsAffectedByTile,
} from './terrain-sector-topology'
import { biomeTextureSpec, terrainTextureSpec, terrainTintForTile } from './terrain-visual-helpers'

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

	it('maps screen tile size to terrain LOD bands', () => {
		expect(terrainLodTilePixels(1)).toBe(60)
		expect(resolveTerrainLod(1)).toBe('detail')
		expect(resolveTerrainLod(0.7)).toBe('texture')
		expect(resolveTerrainLod(0.45)).toBe('overview-fine')
		expect(resolveTerrainLod(0.3)).toBe('overview-medium')
		expect(resolveTerrainLod(0.2)).toBe('overview-coarse')
		expect(resolveTerrainLod(0.1)).toBe('overview-distant')
		expect(resolveTerrainLod(0.05)).toBe('macro')
	})

	it('maps overview LOD bands to progressively coarser macro steps', () => {
		expect(macroStepForTerrainLod('overview-fine')).toBe(1)
		expect(macroStepForTerrainLod('overview-medium')).toBe(2)
		expect(macroStepForTerrainLod('overview-coarse')).toBe(4)
		expect(macroStepForTerrainLod('overview-distant')).toBe(8)
		expect(macroStepForTerrainLod('macro')).toBe(8)
	})

	it('renders terrain hover only for actual tile objects', () => {
		const tileLikeVehicle = { position: { q: 1, r: 2 } }
		const tile = Object.assign(Object.create(Tile.prototype), { position: { q: 1, r: 2 } })

		expect(shouldRenderTerrainHoverForObject(tileLikeVehicle)).toBe(false)
		expect(shouldRenderTerrainHoverForObject(tile)).toBe(true)
	})

	it('sizes macro overview requests from the viewport radius', () => {
		expect(macroRequestForTerrainLod('overview-fine', 70)).toEqual({
			macroStep: 2,
			sectorRadius: 14,
		})
		expect(macroRequestForTerrainLod('macro', 1066)).toEqual({
			macroStep: 11,
			sectorRadius: 72,
		})
	})

	it('prefers explicit concrete terrain over biome-derived textures', () => {
		expect(terrainTextureSpec('concrete', 'grass')).toBe('terrain.concrete')
		expect(terrainTextureSpec('rocky', 'grass')).toBe('terrain.stone')
		expect(terrainTextureSpec('snow', 'grass')).toBe('terrain.snow')
		expect(terrainTextureSpec(undefined, 'grass')).toBe('terrain.grass')
	})

	it('keeps the sector interior on the existing parallelogram grid and expands the bake domain', () => {
		const interior = coordsForSectorInterior('0,0')
		const bakeDomain = coordsForSectorBakeDomain('0,0')
		const displayBounds = computeSectorDisplayBounds('0,0')

		expect(interior).toContainEqual({ q: 0, r: 0 })
		expect(interior).toContainEqual({ q: 16, r: 16 })
		expect(interior).not.toContainEqual({ q: -1, r: 0 })
		expect(bakeDomain.some((coord) => coord.q === -1 && coord.r === 0)).toBe(true)
		expect(bakeDomain.some((coord) => coord.q === 0 && coord.r === -1)).toBe(true)
		expect(bakeDomain.length).toBeGreaterThan(interior.length)
		expect(displayBounds.width).toBeGreaterThan(0)
		expect(displayBounds.height).toBeGreaterThan(0)
	})

	it('marks boundary tiles as affecting multiple sectors', () => {
		const affected = sectorsAffectedByTile({ q: 16, r: 16 })
		expect(affected.length).toBeGreaterThan(1)
		expect(affected).toContain('0,0')
	})

	it('collects shared-boundary terrain triangles from the bake domain', () => {
		const displayBounds = computeSectorDisplayBounds('0,0')
		const bakeTileCoords = coordsForSectorBakeDomain('0,0')
		const terrainTiles = new Map<string, RenderableTerrainTile>()
		for (const coord of bakeTileCoords) {
			terrainTiles.set(axial.key(coord), { terrain: 'grass', height: 0 })
		}

		const collected = collectRenderableTriangles({
			sectorKey: '0,0',
			displayBounds,
			interiorTileCoords: coordsForSectorInterior('0,0'),
			bakeTileCoords,
			terrainTiles,
		})
		const triangles = collected.triangles

		expect(triangles.length).toBeGreaterThan(0)
		expect(collected.totalTriangleCandidates).toBeGreaterThan(triangles.length)
		expect(
			triangles.some((triangle) =>
				triangle.tiles.some(({ coord }) => coord.q === -1 || coord.r === -1)
			)
		).toBe(true)
	})

	it('materializes visible missing sectors through gameplay sector generation', async () => {
		const materialized = new Set<string>()
		const renderable = new Set<string>()
		let ensuredTileCount = 0
		const ensureGameplaySectors = vi.fn(async (sectorKeys: Iterable<string>) => {
			for (const sectorKey of sectorKeys) {
				const entries = coordsForSectorInterior(sectorKey)
				ensuredTileCount += entries.length
				for (const coord of entries) materialized.add(axial.key(coord))
			}
			return true
		})
		const ensureTerrainSectors = vi.fn(async (sectorKeys: Iterable<string>) => {
			for (const sectorKey of sectorKeys) {
				for (const coord of coordsForSectorBakeDomain(sectorKey)) renderable.add(axial.key(coord))
			}
		})
		const requestGameplayFrontier = vi.fn(async () => false)
		const renderer = createTerrainRendererStub({
			hasGameplayContentAt: (coord) => materialized.has(axial.key(coord)),
			hasRenderableTerrainAt: (coord) =>
				materialized.has(axial.key(coord)) || renderable.has(axial.key(coord)),
			getRenderableTerrainAt: (coord) =>
				materialized.has(axial.key(coord)) || renderable.has(axial.key(coord))
					? { terrain: 'grass', height: 0 }
					: undefined,
			ensureGameplaySectors,
			ensureTerrainSectors,
			requestGameplayFrontier,
		})

		const visual = new TerrainVisual(renderer)
		;(visual as any).visibleSectorKeys = new Set(['0,0'])
		await (visual as any).requestSectorFrontier({
			key: '0,0',
			sectorQ: 0,
			sectorR: 0,
			distanceToCenter: 0,
		})

		expect(ensureGameplaySectors).toHaveBeenCalledWith(['0,0'], {
			includeHydrology: true,
			populateInitialGoods: false,
		})
		expect(ensureTerrainSectors).toHaveBeenCalledWith(['0,0'], {
			includeHydrology: true,
		})
		expect(ensuredTileCount).toBeGreaterThan(0)
		expect(requestGameplayFrontier).not.toHaveBeenCalled()
	})

	it('does not generate missing sectors before the viewport settles', async () => {
		const ensureGameplaySectors = vi.fn(async () => false)
		const requestGameplayFrontier = vi.fn(async () => false)
		const renderer = createTerrainRendererStub({
			hasGameplayContentAt: () => false,
			hasRenderableTerrainAt: () => false,
			getRenderableTerrainAt: () => undefined,
			ensureGameplaySectors,
			requestGameplayFrontier,
		})

		const visual = new TerrainVisual(renderer)
		;(visual as any).refresh()
		await Promise.resolve()
		await Promise.resolve()
		await Promise.resolve()

		expect(ensureGameplaySectors).not.toHaveBeenCalled()
		expect(requestGameplayFrontier).not.toHaveBeenCalled()
	})

	it('queues only visible sectors for settled gameplay generation', () => {
		const renderer = createTerrainRendererStub({
			hasGameplayContentAt: () => false,
			hasRenderableTerrainAt: () => false,
			getRenderableTerrainAt: () => undefined,
			requestGameplayFrontier: vi.fn(async () => false),
		})
		const visual = new TerrainVisual(renderer) as any
		visual.visibleSectorKeys = new Set(['0,0', '1,0'])

		const queue = visual.buildVisibleSectorQueue({ q: 0, r: 0 }) as Array<{ key: string }>
		const keys = queue.map((entry) => entry.key)

		expect(keys).toEqual(['0,0', '1,0'])
	})

	it('selects multiple visible sectors for a zoomed-out viewport', () => {
		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: () => false,
			getRenderableTerrainAt: () => undefined,
			requestGameplayFrontier: vi.fn(async () => false),
			screen: { width: 2200, height: 1400 },
			worldScale: 0.7,
		})

		const visual = new TerrainVisual(renderer)
		;(visual as any).refresh()
		const diagnostics = visual.getDiagnostics()

		expect(diagnostics.refresh.visibleSectorCount).toBeGreaterThan(1)
	})

	it('sizes visible selection from viewport corners, not only viewport axes', () => {
		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: () => true,
			getRenderableTerrainAt: () => ({ terrain: 'grass', height: 0 }),
			requestGameplayFrontier: vi.fn(async () => false),
			screen: { width: 1000, height: 1000 },
			worldScale: 1,
		}) as any
		renderer.world.toLocal = (point: { x: number; y: number }) => ({
			x: point.x,
			y: point.y * 3,
		})

		const visual = new TerrainVisual(renderer)
		;(visual as any).refresh()

		const axisOnlyRadius = Math.ceil(500 / tileSize) + 6
		const queueDebug = visual.getQueueDebug()
		const overscannedTopLeftSector = sectorKeyForCoord(
			axial.round(fromCartesian({ x: -90, y: -90 }, tileSize))
		)

		expect(visual.getDiagnostics().refresh.radius).toBeGreaterThan(axisOnlyRadius)
		expect(queueDebug.selection.visibleSectorKeys).toContain(overscannedTopLeftSector)
	})

	it('selects a contiguous multi-sector visible set for default center and viewport', () => {
		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: () => true,
			getRenderableTerrainAt: () => ({ terrain: 'grass', height: 0 }),
			requestGameplayFrontier: vi.fn(async () => false),
			screen: { width: 1920, height: 875 },
			worldScale: 1,
		})

		const visual = new TerrainVisual(renderer)
		;(visual as any).refresh()
		const queueDebug = visual.getQueueDebug()
		const visible = queueDebug.selection.visibleSectorKeys
		expect(visible.length).toBeGreaterThanOrEqual(8)
		expect(visible).toContain('-1,-1')
		expect(visible).toContain('-1,0')
		expect(visible).toContain('0,-1')
		expect(visible).toContain('0,0')
		expect(visible).toContain('1,-1')
		expect(visible).toContain('1,0')
		expect(visible).not.toContain('4,4')
	})

	it('publishes viewport demand from selected sectors', () => {
		const updateTerrainViewportDemand = vi.fn()
		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: () => true,
			getRenderableTerrainAt: () => ({ terrain: 'grass', height: 0 }),
			requestGameplayFrontier: vi.fn(async () => false),
			updateTerrainViewportDemand,
		})
		const visual = new TerrainVisual(renderer)
		;(visual as any).refresh()

		expect(updateTerrainViewportDemand).toHaveBeenCalled()
		const [, demandedCoords] = updateTerrainViewportDemand.mock.calls.at(-1)!
		expect([...(demandedCoords as Iterable<{ q: number; r: number }>)].length).toBeGreaterThan(0)
	})

	it('materializes the corridor between three adjacent sector centers', async () => {
		const materialized = new Set<string>()
		const requestResults: boolean[] = []
		const requestGameplayFrontier = vi.fn(
			async (center: { q: number; r: number }, radius: number) => {
				let generated = false
				for (const coord of axial.allTiles(center, radius)) {
					const key = axial.key(coord)
					if (materialized.has(key)) continue
					materialized.add(key)
					generated = true
				}
				requestResults.push(generated)
				return generated
			}
		)
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

	it('skips resources but keeps textured terrain at middle zoom', () => {
		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: () => true,
			getRenderableTerrainAt: (coord) =>
				coord.q === 0 && coord.r === 0
					? {
							terrain: 'grass',
							height: 0,
							deposit: { type: 'rock', name: 'rock', amount: 2 },
						}
					: { terrain: 'grass', height: 0 },
			requestGameplayFrontier: vi.fn(async () => false),
			worldScale: 0.7,
		})

		const visual = new TerrainVisual(renderer)
		;(visual as any).refresh()

		const diagnostics = visual.getDiagnostics()
		expect(diagnostics.refresh.lodMode).toBe('texture')
		expect(diagnostics.totals.groundTextureGroupRenderables).toBeGreaterThan(0)
		expect(diagnostics.totals.staticResourceSpriteCount).toBe(0)
		expect(diagnostics.totals.skippedResourceSectorCount).toBeGreaterThan(0)
		expect(visual.getBakeDebug().sectors.some((sector) => sector.bakeMode === 'textured')).toBe(
			true
		)
	})

	it('uses macro overview instead of sector bakes at far zoom', () => {
		const ensureTerrainSectors = vi.fn(async () => {})
		const ensureMacroHydrology = vi.fn(async () => {})
		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: () => true,
			getRenderableTerrainAt: (coord) => ({
				terrain: coord.q % 2 === 0 ? 'forest' : 'sand',
				height: 0.1,
			}),
			ensureTerrainSectors,
			ensureMacroHydrology,
			requestGameplayFrontier: vi.fn(async () => false),
			worldScale: 0.1,
		})

		const visual = new TerrainVisual(renderer)
		;(visual as any).refresh()

		const diagnostics = visual.getDiagnostics()
		const bakeDebug = visual.getBakeDebug()
		expect(diagnostics.refresh.lodMode).toBe('overview-distant')
		expect(ensureMacroHydrology).toHaveBeenCalledWith('0,0', {
			macroStep: 8,
			sectorRadius: 12,
		})
		expect(ensureTerrainSectors).not.toHaveBeenCalled()
		expect(diagnostics.refresh.visibleTileCount).toBeGreaterThan(0)
		expect(diagnostics.refresh.visibleSectorCount).toBe(0)
		expect(diagnostics.totals.materialSectorBakeCount).toBe(0)
		expect(bakeDebug.sectors.some((sector) => sector.bakeMode === 'material')).toBe(false)
	})

	it('rebuilds loaded sectors after crossing LOD bands', () => {
		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: () => true,
			getRenderableTerrainAt: () => ({ terrain: 'grass', height: 0 }),
			requestGameplayFrontier: vi.fn(async () => false),
			worldScale: 1,
		}) as any
		const visual = new TerrainVisual(renderer)
		;(visual as any).refresh()
		const sector = ((visual as any).sectors as Map<string, any>).get('0,0')
		expect(sector?.lodMode).toBe('detail')

		renderer.world.scale.x = 0.7
		renderer.world.scale.y = 0.7
		;(visual as any).refresh()

		expect(sector?.lodMode).toBe('texture')
	})

	it('hard-invalidates only sectors affected by one tile without requesting terrain', async () => {
		const requestGameplayFrontier = vi.fn(async () => false)
		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: () => true,
			getRenderableTerrainAt: () => ({ terrain: 'grass', height: 0 }),
			requestGameplayFrontier,
			screen: { width: 1920, height: 875 },
			worldScale: 1,
		})
		const visual = new TerrainVisual(renderer)
		;(visual as any).refresh()

		const sectors = (visual as any).sectors as Map<string, any>
		const affected = new Set(sectorsAffectedByTile({ q: 0, r: 0 }))
		const unaffectedKey = [...sectors.keys()].find((key) => !affected.has(key))
		expect(unaffectedKey).toBeDefined()
		const unaffectedBefore = sectors.get(unaffectedKey!)
		const affectedBefore = new Map([...affected].map((key) => [key, sectors.get(key)]))
		const destroyTexture = vi.fn()
		for (const sector of affectedBefore.values()) {
			if (sector) sector.groundTexture = { destroy: destroyTexture } as unknown as Texture
		}

		visual.invalidateAt({ q: 0, r: 0 }, true)
		await Promise.resolve()
		await Promise.resolve()
		await Promise.resolve()

		expect(requestGameplayFrontier).not.toHaveBeenCalled()
		expect(sectors.get(unaffectedKey!)).toBe(unaffectedBefore)
		expect(destroyTexture).toHaveBeenCalled()
		for (const [key, before] of affectedBefore) {
			if (!before) continue
			expect(sectors.get(key)).not.toBe(before)
		}
	})

	it('invalidates road tile textures and affected sectors after road changes', async () => {
		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: () => true,
			getRenderableTerrainAt: () => ({ terrain: 'grass', height: 0 }),
			requestGameplayFrontier: vi.fn(async () => false),
			screen: { width: 1920, height: 875 },
			worldScale: 1,
		})
		const visual = new TerrainVisual(renderer)
		;(visual as any).refresh()

		const roadTextures = (visual as any).roadTileTextures as { invalidate: (coords: any[]) => void }
		const invalidate = vi.spyOn(roadTextures, 'invalidate')
		const invalidateAt = vi.spyOn(visual, 'invalidateAt')

		;(visual as any).invalidateRoadTiles([{ q: 0, r: 0 }])

		expect(invalidate).toHaveBeenCalledWith([expect.objectContaining({ q: 0, r: 0 })])
		expect(invalidateAt).toHaveBeenCalledWith(expect.objectContaining({ q: 0, r: 0 }))
	})

	it('reports river bake geometry when hydrology-bearing samples are present', () => {
		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: () => true,
			getRenderableTerrainAt: (coord) => ({
				terrain: 'grass',
				height: 0.1,
				hydrology:
					coord.q === 0 && coord.r === 0
						? {
								isChannel: true,
								channelInfluence: 1.4,
								edges: {
									0: { flux: 12, width: 4, depth: 2 },
									5: { flux: 9, width: 3.4, depth: 1.8 },
								},
							}
						: undefined,
			}),
			requestGameplayFrontier: vi.fn(async () => false),
		})

		const visual = new TerrainVisual(renderer)
		;(visual as any).refresh()

		const bakeDebug = visual.getBakeDebug()
		expect(bakeDebug.sectors.some((sector) => sector.riverTileCount > 0)).toBe(true)
		expect(bakeDebug.sectors.some((sector) => sector.riverBranchCount > 0)).toBe(true)
	})

	it('batches static resource sprites per sector without tile visuals', () => {
		const content = Object.create(UnBuiltLand.prototype) as UnBuiltLand
		const depositTile = {
			position: { q: 0, r: 0 },
			content,
		}
		;(content as any).tile = depositTile as any
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

	it('batches static resource sprites from terrain samples without gameplay tiles', () => {
		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: () => true,
			getRenderableTerrainAt: (coord) =>
				coord.q === 0 && coord.r === 0
					? {
							terrain: 'grass',
							height: 0,
							deposit: { type: 'rock', name: 'rock', amount: 2 },
						}
					: { terrain: 'grass', height: 0 },
			requestGameplayFrontier: vi.fn(async () => false),
		})

		const visual = new TerrainVisual(renderer)
		;(visual as any).refresh()

		const diagnostics = visual.getDiagnostics()
		expect(diagnostics.totals.resourceBatchCount).toBeGreaterThan(0)
		expect(diagnostics.totals.staticResourceSpriteCount).toBeGreaterThan(0)
		expect(renderer.layers.resources.renderLayerChildren.length).toBeGreaterThan(0)
	})

	it('passes visible missing sectors as one gameplay sector-list request when available', async () => {
		const materialized = new Set<string>()
		const renderable = new Set<string>()
		const ensureGameplaySectors = vi.fn(async (sectorKeys: Iterable<string>) => {
			for (const sectorKey of sectorKeys) {
				for (const coord of coordsForSectorInterior(sectorKey)) materialized.add(axial.key(coord))
			}
			return true
		})
		const ensureTerrainSectors = vi.fn(async (sectorKeys: Iterable<string>) => {
			for (const sectorKey of sectorKeys) {
				for (const coord of coordsForSectorBakeDomain(sectorKey)) renderable.add(axial.key(coord))
			}
		})
		const renderer = createTerrainRendererStub({
			hasGameplayContentAt: (coord) => materialized.has(axial.key(coord)),
			hasRenderableTerrainAt: (coord) =>
				materialized.has(axial.key(coord)) || renderable.has(axial.key(coord)),
			getRenderableTerrainAt: (coord) =>
				materialized.has(axial.key(coord)) || renderable.has(axial.key(coord))
					? { terrain: 'grass', height: 0 }
					: undefined,
			ensureGameplaySectors,
			ensureTerrainSectors,
			requestGameplayFrontier: vi.fn(async () => false),
		})

		const visual = new TerrainVisual(renderer) as any
		await visual.requestSectorFrontierBatch([
			{ key: '0,0', sectorQ: 0, sectorR: 0, distanceToCenter: 0 },
			{ key: '1,0', sectorQ: 1, sectorR: 0, distanceToCenter: 1 },
		])

		expect(ensureGameplaySectors).toHaveBeenCalledTimes(1)
		expect([...ensureGameplaySectors.mock.calls[0]![0] as Iterable<string>]).toEqual([
			'0,0',
			'1,0',
		])
		expect(ensureTerrainSectors).toHaveBeenCalledTimes(1)
		expect([...ensureTerrainSectors.mock.calls[0]![0] as Iterable<string>]).toEqual([
			'0,0',
			'1,0',
		])
	})

	it('omits sector hydrology outside detail LOD', async () => {
		const materialized = new Set<string>()
		const ensureGameplaySectors = vi.fn(async (sectorKeys: Iterable<string>) => {
			for (const sectorKey of sectorKeys) {
				for (const coord of coordsForSectorInterior(sectorKey)) materialized.add(axial.key(coord))
			}
			return true
		})
		const renderer = createTerrainRendererStub({
			hasGameplayContentAt: (coord) => materialized.has(axial.key(coord)),
			hasRenderableTerrainAt: (coord) => materialized.has(axial.key(coord)),
			getRenderableTerrainAt: (coord) =>
				materialized.has(axial.key(coord)) ? { terrain: 'grass', height: 0 } : undefined,
			ensureGameplaySectors,
			requestGameplayFrontier: vi.fn(async () => false),
			worldScale: 0.1,
		})

		const visual = new TerrainVisual(renderer) as any
		visual.currentLodMode = 'overview-medium'
		await visual.requestSectorFrontierBatch([
			{ key: '0,0', sectorQ: 0, sectorR: 0, distanceToCenter: 0 },
		])

		expect(ensureGameplaySectors.mock.calls[0]![1]).toEqual({
			includeHydrology: false,
			populateInitialGoods: false,
		})
	})

	it('requests macro hydrology for the current sector during refresh', async () => {
		const ensureMacroHydrology = vi.fn(async () => {})
		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: () => true,
			getRenderableTerrainAt: () => ({ terrain: 'grass', height: 0 }),
			ensureMacroHydrology,
			requestGameplayFrontier: vi.fn(async () => false),
			worldScale: 0.1,
		})

		const visual = new TerrainVisual(renderer) as any
		visual.refresh()

		expect(ensureMacroHydrology).toHaveBeenCalledWith('0,0', {
			macroStep: 8,
			sectorRadius: 12,
		})
	})

	it('renders macro terrain overview when a macro snapshot is available', () => {
		const snapshot: TerrainMacroHydrologySnapshot = {
			seed: 7,
			centerSector: { q: 0, r: 0 },
			sectorRadius: 15,
			sectorStep: 17,
			macroStep: 8,
			macroTileCount: 1,
			riverSegmentCount: 1,
			maxAccumulation: 18,
			tiles: [{ q: 0, r: 0, height: 0.1, biome: 'grass' }],
			segments: [{ fromQ: 0, fromR: 0, toQ: 8, toR: 0, flux: 18, width: 2, order: 1 }],
			timings: { wasmMs: 1, unpackMs: 0, totalMs: 1 },
		}
		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: () => true,
			getRenderableTerrainAt: () => ({ terrain: 'grass', height: 0 }),
			getTerrainMacroHydrology: () => snapshot,
			ensureMacroHydrology: vi.fn(async () => {}),
			requestGameplayFrontier: vi.fn(async () => false),
			worldScale: 0.05,
		})

		const visual = new TerrainVisual(renderer) as any
		visual.refresh()

		expect(visual.lastMacroOverlaySignature).toContain('7:0,0')
	})

	it('does not render a stale macro snapshot for another snapped region', () => {
		const snapshot: TerrainMacroHydrologySnapshot = {
			seed: 7,
			centerSector: { q: -8, r: 0 },
			sectorRadius: 12,
			sectorStep: 17,
			macroStep: 4,
			macroTileCount: 1,
			riverSegmentCount: 0,
			maxAccumulation: 0,
			tiles: [{ q: -136, r: 0, height: 0.1, biome: 'grass' }],
			segments: [],
			timings: { wasmMs: 1, unpackMs: 0, totalMs: 1 },
		}
		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: () => true,
			getRenderableTerrainAt: () => ({ terrain: 'grass', height: 0 }),
			getTerrainMacroHydrology: () => snapshot,
			ensureMacroHydrology: vi.fn(async () => {}),
			requestGameplayFrontier: vi.fn(async () => false),
			worldScale: 0.05,
		})

		const visual = new TerrainVisual(renderer) as any
		visual.refresh()

		expect(visual.lastMacroOverlaySignature).toBe('')
	})

	it('accepts a fresh macro snapshot near the origin from a negative sector', () => {
		const snapshot: TerrainMacroHydrologySnapshot = {
			seed: 7,
			centerSector: { q: 0, r: 0 },
			sectorRadius: 15,
			sectorStep: 17,
			macroStep: 8,
			macroTileCount: 1,
			riverSegmentCount: 0,
			maxAccumulation: 0,
			tiles: [{ q: 0, r: 0, height: 0.1, biome: 'grass' }],
			segments: [],
			timings: { wasmMs: 1, unpackMs: 0, totalMs: 1 },
		}
		const ensureMacroHydrology = vi.fn(async () => {})
		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: () => true,
			getRenderableTerrainAt: () => ({ terrain: 'grass', height: 0 }),
			getTerrainMacroHydrology: () => snapshot,
			ensureMacroHydrology,
			requestGameplayFrontier: vi.fn(async () => false),
			worldScale: 0.05,
		}) as any
		renderer.world.toLocal = () => cartesian({ q: -1, r: -1 }, tileSize)

		const visual = new TerrainVisual(renderer) as any
		visual.refresh()

		expect(ensureMacroHydrology).toHaveBeenCalledWith('-1,-1', {
			macroStep: 8,
			sectorRadius: 15,
		})
		expect(visual.lastMacroOverlaySignature).toContain('7:0,0')
	})

	it('does not stream detail sectors while in macro LOD', async () => {
		const ensureTerrainSectors = vi.fn(async () => {})
		const ensureMacroHydrology = vi.fn(async () => {})
		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: () => false,
			getRenderableTerrainAt: () => undefined,
			ensureTerrainSectors,
			ensureMacroHydrology,
			requestGameplayFrontier: vi.fn(async () => false),
			worldScale: 0.01,
		})

		const visual = new TerrainVisual(renderer) as any
		visual.refresh()

		expect(ensureMacroHydrology).toHaveBeenCalledWith('0,0', {
			macroStep: 8,
			sectorRadius: 33,
		})
		expect(ensureTerrainSectors).not.toHaveBeenCalled()
		expect(visual.getDiagnostics().refresh.lodMode).toBe('macro')
		expect(visual.getDiagnostics().refresh.queuedVisibleSectorCount).toBe(0)
	})

	it('uses road segments for the macro road overlay', () => {
		const roadSegments = vi.fn(() => [{ coord: { q: 0.5, r: 0 }, type: 'path' as const }])
		const getBorder = vi.fn(() => ({
			tile: {
				a: { position: { q: 0, r: 0 } },
				b: { position: { q: 1, r: 0 } },
			},
		}))
		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: () => false,
			getRenderableTerrainAt: () => undefined,
			ensureMacroHydrology: vi.fn(async () => {}),
			hex: { roadSegments, getBorder },
			requestGameplayFrontier: vi.fn(async () => false),
			worldScale: 0.01,
		})

		const visual = new TerrainVisual(renderer) as any
		visual.refresh()

		expect(roadSegments).toHaveBeenCalled()
		expect(getBorder).toHaveBeenCalledWith(expect.objectContaining({ q: 0.5, r: 0 }))
	})

	it('renders generated NPC zones in macro overview', () => {
		const getRenderableTerrainAt = vi.fn((coord: { q: number; r: number }) => ({
			terrain: 'grass' as const,
			height: 0,
			zone:
				coord.q === 0 && coord.r === 0
					? { id: 'market', name: 'Market', color: '#d6a34c', generated: true }
					: undefined,
		}))
		const renderer = createTerrainRendererStub({
			hasRenderableTerrainAt: () => true,
			getRenderableTerrainAt,
			ensureMacroHydrology: vi.fn(async () => {}),
			requestGameplayFrontier: vi.fn(async () => false),
			worldScale: 0.01,
		})

		const visual = new TerrainVisual(renderer) as any
		visual.refresh()

		expect(getRenderableTerrainAt).toHaveBeenCalled()
		expect(visual.macroGeneratedZoneOverlay.visible).toBe(true)
		expect(visual.macroGeneratedZoneOverlay.context.instructions.length).toBeGreaterThan(0)
	})
})

function createTerrainRendererStub(gameOverrides: {
	hasGameplayContentAt?(coord: { q: number; r: number }): boolean
	hasRenderableTerrainAt(coord: { q: number; r: number }): boolean
	getRenderableTerrainAt(coord: { q: number; r: number }): RenderableTerrainTile | undefined
	ensureGameplaySectors?(
		sectorKeys: Iterable<string>,
		options?: { includeHydrology?: boolean; populateInitialGoods?: boolean }
	): Promise<boolean>
	ensureTerrainSamples?(coords: Iterable<{ q: number; r: number }>): Promise<void>
	ensureTerrainSectors?(
		sectorKeys: Iterable<string>,
		options?: { includeHydrology?: boolean }
	): Promise<void>
	ensureMacroHydrology?(
		centerSectorKey: string,
		options?: { macroStep?: number; sectorRadius?: number }
	): Promise<void>
	getTerrainMacroHydrology?(): import('engine-terrain').TerrainMacroHydrologySnapshot | undefined
	hex?: {
		getTile?(coord: { q: number; r: number }): unknown
		roadSegments?(): Array<{ coord: { q: number; r: number }; type: 'path' }>
		getBorder?(coord: { q: number; r: number }): unknown
	}
	requestGameplayFrontier(
		center: { q: number; r: number },
		radius: number,
		options: { maxBatchSize: number }
	): Promise<boolean>
	screen?: { width: number; height: number }
	worldScale?: number
	updateTerrainViewportDemand?(viewportId: string, coords: Iterable<{ q: number; r: number }>): void
	clearTerrainViewportDemand?(viewportId: string): void
	getTerrainProviderDiagnostics?(): {
		cacheSize: number
		inFlightSize: number
		viewportCount: number
		demandedCoords: number
		hits: number
		misses: number
		ensures: number
		generatedTiles: number
		evictions: number
		lastEnsureMs: number
		maxEnsureMs: number
	}
}): PixiGameRenderer {
	const screen = gameOverrides.screen ?? { width: 240, height: 180 }
	const worldScale = gameOverrides.worldScale ?? 1
	return {
		game: gameOverrides,
		app: {
			screen,
			renderer: {
				textureGenerator: {
					generateTexture() {
						return Texture.WHITE
					},
				},
			},
		},
		world: {
			scale: { x: worldScale, y: worldScale },
			toLocal(point: { x: number; y: number }) {
				return point
			},
		},
		worldScene: new Container(),
		layers: {
			ground: new RenderLayer(),
			roads: new RenderLayer(),
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
			expect(spec.startsWith('terrain.') || spec.startsWith('objects.') || spec.startsWith('roads.')).toBe(
				true
			)
			return Texture.WHITE
		},
	} as unknown as PixiGameRenderer
}
