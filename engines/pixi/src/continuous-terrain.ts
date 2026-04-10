import { defer, effect, type ScopedCallback } from 'mutts'
import { Container, Graphics, Particle, ParticleContainer, Point, Rectangle, Sprite, Texture } from 'pixi.js'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { mrg } from 'ssh/interactive-state'
import type { RenderableTerrainTile } from 'ssh/game/game'
import { axial, cartesian, fromCartesian, type AxialCoord } from 'ssh/utils'
import { tileSize } from 'ssh/utils/varied'
import { setPixiName } from './debug-names'
import type { PixiGameRenderer } from './renderer'
import {
	buildStaticResourceSpriteSpecs,
	buildStaticResourceSpriteSpecsFromTerrainSample,
	resolveUsableTexture,
} from './renderers/static-resource-sprites'
import {
	SectorTerrainBaker,
	type SectorTerrainBakeDebug,
	type SectorTerrainBakeInput,
} from './terrain-sector-baker'
import {
	coordsForSectorBakeDomain,
	coordsForSectorInterior,
	createSectorCoverage,
	sectorKeyForCoord,
	sectorsAffectedByTile,
	terrainSectorStep,
} from './terrain-sector-topology'

const SECTOR_RADIUS = 8
// Hex regions of radius R tile edge-to-edge when their centers are spaced by 2R + 1.
const SECTOR_STEP = terrainSectorStep
// Keep nearby sectors in memory to reduce render churn while panning.
const RETAINED_SECTOR_MARGIN = 2
// Visible sectors are stored as axial rectangles, whose furthest corner is farther
// than SECTOR_RADIUS from the sector center on a hex metric.
// Baked sectors depend on a one-tile expanded domain around the interior.
// The furthest bake-domain corners sit at SECTOR_STEP + 1 hex distance
// from the sector center for the current axial-rectangle topology.
const GAMEPLAY_STREAM_RADIUS = SECTOR_STEP + 1
const GAMEPLAY_STREAM_BATCH_SIZE = 96
const TERRAIN_DIAGNOSTIC_HISTORY_LIMIT = 12
const SLOW_SECTOR_LOG_THRESHOLD_MS = 16
const MAX_PENDING_SECTORS = 3
const MAX_SECTOR_STARTS_PER_REFRESH = 2
const PREFETCH_SECTOR_MARGIN = 1
const VIEWPORT_WORLD_OVERSCAN = tileSize * 3
const HEX_HALF_WIDTH = (Math.sqrt(3) / 2) * tileSize
const HEX_HALF_HEIGHT = tileSize
const USE_PARTICLE_RESOURCE_BATCH = false

export interface TerrainSectorDiagnostics {
	sectorKey: string
	visibleTileCount: number
	renderedTileCount: number
	missingTileCount: number
	groundBatchCount: number
	resourceBatchCount: number
	staticResourceSpriteCount: number
	pendingSectorCountAtStart: number
	timings: {
		groundBatchBuildMs: number
		resourceBatchBuildMs: number
		totalSectorMs: number
	}
}

export interface TerrainRefreshDiagnostics {
	center: AxialCoord
	radius: number
	visibleTileCount: number
	materializedVisibleTileCount: number
	visibleSectorCount: number
	loadedVisibleSectorCount: number
	missingVisibleSectorCount: number
	queuedVisibleSectorCount: number
	pendingSectorCount: number
	retainedSectorCount: number
	loadedSectorCount: number
	refreshMs: number
}

export interface TerrainStreamingDiagnostics {
	refresh: TerrainRefreshDiagnostics
	recentSectors: TerrainSectorDiagnostics[]
	totals: {
		sectorsRendered: number
		groundTextureGroupRenderables: number
		groundSectorBatchCount: number
		resourceBatchCount: number
		staticResourceSpriteCount: number
		maxSectorTotalMs: number
	}
}

export interface TerrainBakeDebugSnapshot {
	sectors: SectorTerrainBakeDebug[]
}

export interface TerrainQueueDebugSnapshot {
	frame: {
		center: AxialCoord
		radius: number
		screen: { width: number; height: number }
		worldScale: { x: number; y: number }
	}
	selection: {
		visibleSectorKeys: string[]
		prefetchSectorKeys: string[]
		queuedVisibleKeys: string[]
		queuedPrefetchKeys: string[]
	}
	queue: {
		total: number
		visibleCount: number
		prefetchCount: number
		topKeys: string[]
	}
	provider?: {
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
	recentRequests: Array<{
		sectorKey: string
		mode: 'ensure' | 'frontier'
		missingBakeTiles: number
		generated: boolean
		ms: number
	}>
}

interface QueuedSector {
	key: string
	sectorQ: number
	sectorR: number
	distanceToCenter: number
}

interface WorldBounds {
	minX: number
	maxX: number
	minY: number
	maxY: number
}

interface SectorVisualState {
	container: Container
	groundLayer: Container
	resourceLayer: Container
	groundSprite?: Sprite
	coverage: ReturnType<typeof createSectorCoverage>
	dirty: boolean
	resourcesBuilt: boolean
}

interface ResourceSpriteBuild {
	texture: Texture
	x: number
	y: number
	scale: number
}

function isHoveredTileObject(value: unknown): value is { position: AxialCoord } {
	if (!value || typeof value !== 'object') return false
	const position = (value as { position?: { q?: unknown; r?: unknown } }).position
	return (
		!!position &&
		typeof position.q === 'number' &&
		typeof position.r === 'number' &&
		Number.isInteger(position.q) &&
		Number.isInteger(position.r)
	)
}

export class TerrainVisual {
	private static viewportSequence = 0
	private readonly container = setPixiName(new Container(), 'terrain.continuous')
	private readonly sectorsContainer = setPixiName(new Container(), 'terrain.continuous:sectors')
	private readonly hoverOverlay = setPixiName(new Graphics(), 'terrain.continuous:hover')
	private isBound = false
	private lastSignature = ''
	private readonly sectors = new Map<string, SectorVisualState>()
	private readonly sectorCoords = new Map<string, AxialCoord[]>()
	private readonly pendingSectors = new Set<string>()
	private readonly dirtySectorKeys = new Set<string>()
	private readonly terrainBaker: SectorTerrainBaker
	private readonly bakeDebugBySector = new Map<string, SectorTerrainBakeDebug>()
	private visibleTileKeys = new Set<string>()
	private visibleSectorKeys = new Set<string>()
	private visibleSectorQueue: QueuedSector[] = []
	private refreshScheduled = false
	private refreshScheduledClearCache = false
	private readonly viewportId = `terrain-viewport-${++TerrainVisual.viewportSequence}`
	private queueDebug: TerrainQueueDebugSnapshot = {
		frame: {
			center: { q: 0, r: 0 },
			radius: 0,
			screen: { width: 0, height: 0 },
			worldScale: { x: 1, y: 1 },
		},
		selection: {
			visibleSectorKeys: [],
			prefetchSectorKeys: [],
			queuedVisibleKeys: [],
			queuedPrefetchKeys: [],
		},
		queue: {
			total: 0,
			visibleCount: 0,
			prefetchCount: 0,
			topKeys: [],
		},
		provider: undefined,
		recentRequests: [],
	}
	private diagnostics: TerrainStreamingDiagnostics = {
		refresh: {
			center: { q: 0, r: 0 },
			radius: 0,
			visibleTileCount: 0,
			materializedVisibleTileCount: 0,
			visibleSectorCount: 0,
			loadedVisibleSectorCount: 0,
			missingVisibleSectorCount: 0,
			queuedVisibleSectorCount: 0,
			pendingSectorCount: 0,
			retainedSectorCount: 0,
			loadedSectorCount: 0,
			refreshMs: 0,
		},
		recentSectors: [],
		totals: {
			sectorsRendered: 0,
			groundTextureGroupRenderables: 0,
			groundSectorBatchCount: 0,
			resourceBatchCount: 0,
			staticResourceSpriteCount: 0,
			maxSectorTotalMs: 0,
		},
	}
	private hoverCleanup?: ScopedCallback

	constructor(private readonly renderer: PixiGameRenderer) {
		this.terrainBaker = new SectorTerrainBaker(renderer)
		this.container.eventMode = 'none'
		this.sectorsContainer.eventMode = 'none'
		this.hoverOverlay.eventMode = 'none'
		this.container.addChild(this.sectorsContainer, this.hoverOverlay)
	}

	public bind() {
		this.isBound = true
		this.renderer.worldScene.addChild(this.container)
		this.renderer.attachToLayer(this.renderer.layers.ground, this.container)
		this.renderer.app?.ticker.add(this.refresh)
		this.hoverCleanup = effect`terrain.hover`(() => {
			this.renderHoverOverlay(isHoveredTileObject(mrg.hoveredObject) ? mrg.hoveredObject : undefined)
		})
		this.refresh()
	}

	public dispose() {
		this.isBound = false
		this.renderer.app?.ticker.remove(this.refresh)
		;(
			this.renderer.game as {
				clearTerrainViewportDemand?: (viewportId: string) => void
			}
		).clearTerrainViewportDemand?.(this.viewportId)
		this.hoverCleanup?.()
		this.hoverCleanup = undefined
		if (this.renderer.layers?.ground) {
			this.renderer.detachFromLayer(this.renderer.layers.ground, this.container)
		}
		for (const sector of this.sectors.values()) this.destroySectorVisualState(sector)
		this.sectors.clear()
		this.container.destroy({ children: true })
	}

	public getDiagnostics(): TerrainStreamingDiagnostics {
		return {
			refresh: { ...this.diagnostics.refresh, center: { ...this.diagnostics.refresh.center } },
			recentSectors: this.diagnostics.recentSectors.map((sector) => ({
				...sector,
				timings: { ...sector.timings },
			})),
			totals: { ...this.diagnostics.totals },
		}
	}

	public getBakeDebug(): TerrainBakeDebugSnapshot {
		return {
			sectors: [...this.bakeDebugBySector.values()].sort((left, right) =>
				left.sectorKey.localeCompare(right.sectorKey)
			),
		}
	}

	public getQueueDebug(): TerrainQueueDebugSnapshot {
		return {
			frame: {
				center: { ...this.queueDebug.frame.center },
				radius: this.queueDebug.frame.radius,
				screen: { ...this.queueDebug.frame.screen },
				worldScale: { ...this.queueDebug.frame.worldScale },
			},
			selection: {
				visibleSectorKeys: [...this.queueDebug.selection.visibleSectorKeys],
				prefetchSectorKeys: [...this.queueDebug.selection.prefetchSectorKeys],
				queuedVisibleKeys: [...this.queueDebug.selection.queuedVisibleKeys],
				queuedPrefetchKeys: [...this.queueDebug.selection.queuedPrefetchKeys],
			},
			queue: {
				total: this.queueDebug.queue.total,
				visibleCount: this.queueDebug.queue.visibleCount,
				prefetchCount: this.queueDebug.queue.prefetchCount,
				topKeys: [...this.queueDebug.queue.topKeys],
			},
			provider: this.queueDebug.provider ? { ...this.queueDebug.provider } : undefined,
			recentRequests: this.queueDebug.recentRequests.map((request) => ({ ...request })),
		}
	}

	public invalidate(clearCache = false) {
		this.markAllSectorsDirty(clearCache)
		this.scheduleInvalidate(clearCache)
	}

	public invalidateAt(coord: AxialCoord, clearCache = false) {
		for (const sectorKey of sectorsAffectedByTile(coord, SECTOR_STEP)) {
			this.dirtySectorKeys.add(sectorKey)
			const state = this.sectors.get(sectorKey)
			if (state) state.dirty = true
		}
		if (clearCache) {
			this.clearSectors()
			this.dirtySectorKeys.clear()
		}
		this.scheduleInvalidate(clearCache)
	}

	private markAllSectorsDirty(clearCache = false) {
		if (clearCache) {
			this.clearSectors()
			this.dirtySectorKeys.clear()
		} else {
			for (const key of this.sectors.keys()) this.dirtySectorKeys.add(key)
		}
	}

	private scheduleInvalidate(clearCache = false) {
		this.refreshScheduledClearCache = this.refreshScheduledClearCache || clearCache
		if (this.refreshScheduled) return
		this.refreshScheduled = true
		defer(() => {
			this.refreshScheduled = false
			const shouldClearCache = this.refreshScheduledClearCache
			this.refreshScheduledClearCache = false
			if (shouldClearCache) {
				this.clearSectors()
				this.dirtySectorKeys.clear()
			}
			this.lastSignature = ''
			this.refresh()
		})
	}

	private refresh = () => {
		const refreshStartedAt = nowMs()
		const app = this.renderer.app
		const world = this.renderer.world
		if (!app || !world) return

		const screenCenter = new Point(app.screen.width / 2, app.screen.height / 2)
		const localCenter = world.toLocal(screenCenter)
		const center = axial.round(fromCartesian(localCenter, tileSize))
		const worldHalfWidth = app.screen.width / (2 * Math.max(world.scale.x, 0.001))
		const worldHalfHeight = app.screen.height / (2 * Math.max(world.scale.y, 0.001))
		const radius = Math.ceil(Math.max(worldHalfWidth, worldHalfHeight) / tileSize) + 6
		const signature = `${center.q},${center.r}:${radius}:${app.screen.width}x${app.screen.height}`
		if (signature === this.lastSignature) return
		this.lastSignature = signature

		const minQ = center.q - radius
		const maxQ = center.q + radius
		const minR = center.r - radius
		const maxR = center.r + radius
		const viewportBounds = this.currentViewportWorldBounds()
		this.visibleTileKeys = collectVisibleTileKeys(center, radius + 2, viewportBounds)
		this.visibleSectorKeys = collectVisibleSectorKeys(this.visibleTileKeys)

		const sectorMinQ = Math.floor(minQ / SECTOR_STEP)
		const sectorMaxQ = Math.floor(maxQ / SECTOR_STEP)
		const sectorMinR = Math.floor(minR / SECTOR_STEP)
		const sectorMaxR = Math.floor(maxR / SECTOR_STEP)
		const retainedSectorKeys = this.collectSectorKeys(
			sectorMinQ - RETAINED_SECTOR_MARGIN,
			sectorMaxQ + RETAINED_SECTOR_MARGIN,
			sectorMinR - RETAINED_SECTOR_MARGIN,
			sectorMaxR + RETAINED_SECTOR_MARGIN
		)

		for (const [sectorKey, sector] of this.sectors) {
			if (retainedSectorKeys.has(sectorKey)) continue
			this.destroySectorVisualState(sector)
			this.sectors.delete(sectorKey)
			this.sectorCoords.delete(sectorKey)
		}

		for (const sectorKey of retainedSectorKeys) {
			if (this.sectors.has(sectorKey)) continue
			const state = this.createSectorVisualState(sectorKey)
			this.sectors.set(sectorKey, state)
			this.sectorCoords.set(sectorKey, this.coordsForSectorKey(sectorKey))
			this.sectorsContainer.addChild(state.container)
		}

		const materializedVisibleTileCount = countMaterializedVisibleTiles(this.visibleTileKeys, this.renderer)
		this.syncLoadedSectorVisuals()
		this.visibleSectorQueue = this.buildVisibleSectorQueue(center)
		this.pumpVisibleSectorQueue()

		const loadedVisibleSectorCount = countMatchingKeys(this.visibleSectorKeys, this.sectors)
		const pendingVisibleSectorCount = countMatchingKeys(this.visibleSectorKeys, this.pendingSectors)
		const missingVisibleSectorCount =
			this.visibleSectorKeys.size - loadedVisibleSectorCount + this.visibleSectorQueue.length

		this.diagnostics.refresh = {
			center,
			radius,
			visibleTileCount: this.visibleTileKeys.size,
			materializedVisibleTileCount,
			visibleSectorCount: this.visibleSectorKeys.size,
			loadedVisibleSectorCount,
			missingVisibleSectorCount,
			queuedVisibleSectorCount: this.visibleSectorQueue.length,
			pendingSectorCount: this.pendingSectors.size,
			retainedSectorCount: retainedSectorKeys.size,
			loadedSectorCount: this.sectors.size,
			refreshMs: nowMs() - refreshStartedAt,
		}

		this.queueDebug.frame = {
			center,
			radius,
			screen: { width: app.screen.width, height: app.screen.height },
			worldScale: { x: world.scale.x, y: world.scale.y },
		}
		this.queueDebug.selection.visibleSectorKeys = [...this.visibleSectorKeys].sort()
		this.queueDebug.provider = (
			this.renderer.game as {
				getTerrainProviderDiagnostics?: () => TerrainQueueDebugSnapshot['provider']
			}
		).getTerrainProviderDiagnostics?.()
		this.updateViewportDemand()
	}

	private clearSectors() {
		for (const sector of this.sectors.values()) this.destroySectorVisualState(sector)
		this.sectors.clear()
		this.sectorCoords.clear()
		this.visibleSectorKeys.clear()
		this.visibleSectorQueue = []
		this.bakeDebugBySector.clear()
	}

	private destroySectorVisualState(sectorState: SectorVisualState) {
		if (this.renderer.layers?.resources) {
			this.renderer.detachFromLayer(this.renderer.layers.resources, sectorState.resourceLayer)
		}
		sectorState.container.destroy({ children: true })
	}

	private renderHoverOverlay(tile: { position: AxialCoord } | undefined) {
		this.hoverOverlay.clear()
		if (!tile) return

		const coord = tile.position as AxialCoord
		const center = cartesian(coord, tileSize)
		const points = Array.from({ length: 6 }, (_, i) => {
			const angle = (Math.PI / 3) * (i + 0.5)
			return new Point(center.x + Math.cos(angle) * tileSize, center.y + Math.sin(angle) * tileSize)
		})
		this.hoverOverlay
			.poly(points)
			.fill({ color: 0x7fb8ff, alpha: 0.28 })
			.stroke({ width: 2.5, color: 0x7fb8ff, alpha: 0.92 })
	}

	private createSectorVisualState(sectorKey: string): SectorVisualState {
		const container = setPixiName(new Container(), `terrain.continuous:${sectorKey}`)
		container.eventMode = 'none'
		const groundLayer = setPixiName(new Container(), `terrain.continuous:${sectorKey}:ground`)
		const resourceLayer = setPixiName(new Container(), `terrain.continuous:${sectorKey}:resources`)
		groundLayer.eventMode = 'none'
		resourceLayer.eventMode = 'none'
		container.addChild(groundLayer, resourceLayer)
		this.renderer.attachToLayer(this.renderer.layers.resources, resourceLayer)
		return {
			container,
			groundLayer,
			resourceLayer,
			coverage: createSectorCoverage(sectorKey, SECTOR_STEP),
			dirty: true,
			resourcesBuilt: false,
		}
	}

	private syncLoadedSectorVisuals() {
		for (const [sectorKey, sectorState] of this.sectors) {
			if (!this.visibleSectorKeys.has(sectorKey)) {
				sectorState.container.visible = false
				continue
			}
			this.renderSectorVisuals(sectorKey, sectorState)
		}
	}

	private renderSectorVisuals(
		sectorKey: string,
		sectorState: SectorVisualState
	): { renderedTileCount: number; missingTileCount: number } {
		const sectorStartedAt = nowMs()
		const visibleCoords = sectorState.coverage.interiorTileCoords.filter((coord) =>
			this.visibleTileKeys.has(axial.key(coord))
		)
		let missingTileCount = 0
		for (const coord of sectorState.coverage.bakeTileCoords) {
			if (!this.renderer.game.hasRenderableTerrainAt(coord)) missingTileCount++
		}
		const isDirty = sectorState.dirty || this.dirtySectorKeys.has(sectorKey)
		const renderedTileCount = countMaterializedCoords(visibleCoords, this.visibleTileKeys, this.renderer)
		if (missingTileCount > 0) {
			sectorState.container.visible = !!sectorState.groundSprite && renderedTileCount > 0
			return {
				renderedTileCount,
				missingTileCount,
			}
		}
		if (!isDirty && missingTileCount === 0 && sectorState.groundSprite && sectorState.resourcesBuilt) {
			sectorState.container.visible = renderedTileCount > 0
			return {
				renderedTileCount,
				missingTileCount,
			}
		}

		const groundStartedAt = nowMs()
		const groundBatchCount = this.rebuildSectorGround(sectorKey, sectorState)
		const groundBatchBuildMs = nowMs() - groundStartedAt
		const resourceStartedAt = nowMs()
		const { resourceBatchCount, staticResourceSpriteCount } = this.rebuildSectorResources(sectorKey, sectorState)
		const resourceBatchBuildMs = nowMs() - resourceStartedAt

		sectorState.container.visible = renderedTileCount > 0
		sectorState.dirty = false
		this.dirtySectorKeys.delete(sectorKey)

		const totalSectorMs = nowMs() - sectorStartedAt
		this.recordSectorDiagnostics(
			sectorKey,
			visibleCoords.length,
			renderedTileCount,
			missingTileCount,
			groundBatchCount,
			resourceBatchCount,
			staticResourceSpriteCount,
			0,
			groundBatchBuildMs,
			resourceBatchBuildMs,
			totalSectorMs
		)

		return { renderedTileCount, missingTileCount }
	}

	private clearSectorVisuals(sectorState: SectorVisualState) {
		for (const child of sectorState.groundLayer.removeChildren()) child.destroy({ children: true })
		for (const child of sectorState.resourceLayer.removeChildren()) {
			child.destroy({ children: true })
		}
		sectorState.groundSprite = undefined
		sectorState.resourcesBuilt = false
	}

	private rebuildSectorGround(sectorKey: string, sectorState: SectorVisualState): number {
		if (!sectorState.dirty && !this.dirtySectorKeys.has(sectorKey) && sectorState.groundSprite) {
			return 1
		}

		for (const child of sectorState.groundLayer.removeChildren()) child.destroy({ children: true })
		sectorState.groundSprite = undefined

		const terrainTiles = new Map<string, RenderableTerrainTile>()
		for (const coord of sectorState.coverage.bakeTileCoords) {
			const terrainTile = this.renderer.game.getRenderableTerrainAt(coord)
			if (!terrainTile) continue
			terrainTiles.set(axial.key(coord), terrainTile)
		}
		if (terrainTiles.size === 0) return 0

		const bakeInput: SectorTerrainBakeInput = {
			sectorKey,
			displayBounds: sectorState.coverage.displayBounds,
			interiorTileCoords: sectorState.coverage.interiorTileCoords,
			bakeTileCoords: sectorState.coverage.bakeTileCoords,
			terrainTiles,
		}
		const baked = this.terrainBaker.bake(bakeInput)
		this.bakeDebugBySector.set(sectorKey, baked.debug)
		const generatedTexture = baked.texture
		if (!generatedTexture) return 0

		const sprite = setPixiName(
			new Sprite(generatedTexture),
			`terrain.continuous:${sectorKey}:baked-ground`
		)
		sprite.eventMode = 'none'
		sprite.position.set(
			sectorState.coverage.displayBounds.x,
			sectorState.coverage.displayBounds.y
		)
		sectorState.groundLayer.addChild(sprite)
		sectorState.groundSprite = sprite
		return 1
	}

	private rebuildSectorResources(
		sectorKey: string,
		sectorState: SectorVisualState
	): { resourceBatchCount: number; staticResourceSpriteCount: number } {
		if (!sectorState.dirty && !this.dirtySectorKeys.has(sectorKey) && sectorState.resourcesBuilt) {
			const existingSprites = sectorState.resourceLayer.children.reduce((count, child) => {
				if (child instanceof ParticleContainer) return count + child.particleChildren.length
				if (child instanceof Container) return count + child.children.length
				return count
			}, 0)
			return {
				resourceBatchCount: sectorState.resourceLayer.children.length,
				staticResourceSpriteCount: existingSprites,
			}
		}

		for (const child of sectorState.resourceLayer.removeChildren()) {
			child.destroy({ children: true })
		}

		const grouped = new Map<string, ResourceSpriteBuild[]>()
		for (const coord of sectorState.coverage.interiorTileCoords) {
			const terrainSample = this.renderer.game.getRenderableTerrainAt(coord)
			if (terrainSample?.deposit) {
				const specs = buildStaticResourceSpriteSpecsFromTerrainSample(coord, terrainSample, (spec) =>
					resolveUsableTexture(this.renderer, spec)
				)
				for (const spec of specs) {
					const texture = resolveUsableTexture(this.renderer, spec.textureKey)
					if (!texture) continue
					if (!grouped.has(spec.textureKey)) grouped.set(spec.textureKey, [])
					grouped.get(spec.textureKey)!.push({
						texture,
						x: spec.x,
						y: spec.y,
						scale: spec.scale,
					})
				}
				continue
			}

			const tile = this.renderer.game.hex?.getTile?.(coord)
			const content = tile?.content
			if (!(content instanceof UnBuiltLand) || !content.deposit) continue
			const specs = buildStaticResourceSpriteSpecs(content, (spec) =>
				resolveUsableTexture(this.renderer, spec)
			)
			for (const spec of specs) {
				const texture = resolveUsableTexture(this.renderer, spec.textureKey)
				if (!texture) continue
				if (!grouped.has(spec.textureKey)) grouped.set(spec.textureKey, [])
				grouped.get(spec.textureKey)!.push({
					texture,
					x: spec.x,
					y: spec.y,
					scale: spec.scale,
				})
			}
		}

		let resourceBatchCount = 0
		let staticResourceSpriteCount = 0
		let sectorMinX = Number.POSITIVE_INFINITY
		let sectorMinY = Number.POSITIVE_INFINITY
		let sectorMaxX = Number.NEGATIVE_INFINITY
		let sectorMaxY = Number.NEGATIVE_INFINITY
		for (const [textureKey, builds] of grouped) {
			if (builds.length === 0) continue
			const texture = builds[0]?.texture
			if (!texture) continue
			const particleContainer = USE_PARTICLE_RESOURCE_BATCH
				? setPixiName(
						new ParticleContainer({
							texture,
							dynamicProperties: {
								position: true,
								scale: true,
								rotation: false,
								uvs: false,
								vertex: false,
								color: false,
							},
						}),
						`terrain.continuous:${sectorKey}:resources:${textureKey}`
					)
				: setPixiName(
						new Container({
							label: `terrain.continuous:${sectorKey}:resources:${textureKey}:sprites`,
						}),
						`terrain.continuous:${sectorKey}:resources:${textureKey}`
					)
			particleContainer.eventMode = 'none'
			let minX = Number.POSITIVE_INFINITY
			let minY = Number.POSITIVE_INFINITY
			let maxX = Number.NEGATIVE_INFINITY
			let maxY = Number.NEGATIVE_INFINITY
			for (const build of builds) {
				if (USE_PARTICLE_RESOURCE_BATCH) {
						;(particleContainer as ParticleContainer).addParticle(
							new Particle({
								texture: build.texture,
								anchorX: 0.5,
								anchorY: 1,
								x: build.x,
								y: build.y,
								scaleX: build.scale,
								scaleY: build.scale,
							})
						)
				} else {
					const sprite = new Sprite(build.texture)
					sprite.anchor.set(0.5, 1)
					sprite.position.set(build.x, build.y)
					sprite.scale.set(build.scale)
					;(particleContainer as Container).addChild(sprite)
				}
				const halfWidth = (build.texture.width * build.scale) / 2
				const height = build.texture.height * build.scale
				minX = Math.min(minX, build.x - halfWidth)
				maxX = Math.max(maxX, build.x + halfWidth)
				minY = Math.min(minY, build.y - height)
				maxY = Math.max(maxY, build.y)
			}
			particleContainer.boundsArea = new Rectangle(minX, minY, maxX - minX, maxY - minY)
			if (USE_PARTICLE_RESOURCE_BATCH) {
				;(particleContainer as ParticleContainer).update()
			}
			sectorState.resourceLayer.addChild(particleContainer)
			sectorMinX = Math.min(sectorMinX, minX)
			sectorMinY = Math.min(sectorMinY, minY)
			sectorMaxX = Math.max(sectorMaxX, maxX)
			sectorMaxY = Math.max(sectorMaxY, maxY)
			resourceBatchCount++
			staticResourceSpriteCount += builds.length
		}

		if (resourceBatchCount > 0) {
			sectorState.resourceLayer.boundsArea = new Rectangle(
				sectorMinX,
				sectorMinY,
				sectorMaxX - sectorMinX,
				sectorMaxY - sectorMinY
			)
		} else {
			const sectorBounds = computeWorldBounds(sectorState.coverage.interiorTileCoords)
			sectorState.resourceLayer.boundsArea = new Rectangle(
				sectorBounds.minX,
				sectorBounds.minY,
				sectorBounds.maxX - sectorBounds.minX,
				sectorBounds.maxY - sectorBounds.minY
			)
		}

		sectorState.resourcesBuilt = true

		return { resourceBatchCount, staticResourceSpriteCount }
	}

	private coordsForSectorKey(sectorKey: string): AxialCoord[] {
		const cached = this.sectorCoords.get(sectorKey)
		if (cached) return cached
		const coords = coordsForSectorInterior(sectorKey, SECTOR_STEP)
		this.sectorCoords.set(sectorKey, coords)
		return coords
	}

	private collectSectorKeys(minQ: number, maxQ: number, minR: number, maxR: number): Set<string> {
		const keys = new Set<string>()
		for (let q = minQ; q <= maxQ; q++) {
			for (let r = minR; r <= maxR; r++) {
				keys.add(`${q},${r}`)
			}
		}
		return keys
	}

	private buildVisibleSectorQueue(center: AxialCoord): QueuedSector[] {
		const visibleQueue = this.buildSectorQueueForKeys(this.visibleSectorKeys, center)
		const prefetchKeys = this.collectQueuedSectorKeys()
		for (const key of this.visibleSectorKeys) prefetchKeys.delete(key)
		const prefetchQueue = this.buildSectorQueueForKeys(prefetchKeys, center)
		const queue = [...visibleQueue, ...prefetchQueue]
		this.queueDebug.selection.prefetchSectorKeys = [...prefetchKeys].sort()
		this.queueDebug.selection.queuedVisibleKeys = visibleQueue.map((entry) => entry.key)
		this.queueDebug.selection.queuedPrefetchKeys = prefetchQueue.map((entry) => entry.key)
		this.queueDebug.queue = {
			total: queue.length,
			visibleCount: visibleQueue.length,
			prefetchCount: prefetchQueue.length,
			topKeys: queue.slice(0, 20).map((entry) => entry.key),
		}
		return queue
	}

	private updateViewportDemand() {
		const demandedSectorKeys = new Set<string>()
		for (const key of this.visibleSectorKeys) demandedSectorKeys.add(key)
		for (const key of this.queueDebug.selection.prefetchSectorKeys) demandedSectorKeys.add(key)
		const demandedCoords = new Map<string, AxialCoord>()
		for (const sectorKey of demandedSectorKeys) {
			for (const coord of coordsForSectorBakeDomain(sectorKey, SECTOR_STEP)) {
				demandedCoords.set(axial.key(coord), coord)
			}
		}
		;(
			this.renderer.game as {
				updateTerrainViewportDemand?: (viewportId: string, coords: Iterable<AxialCoord>) => void
			}
		).updateTerrainViewportDemand?.(this.viewportId, demandedCoords.values())
	}

	private buildSectorQueueForKeys(keys: Iterable<string>, center: AxialCoord): QueuedSector[] {
		const queue: QueuedSector[] = []
		for (const key of keys) {
			if (this.pendingSectors.has(key)) continue
			const bakeCoords = coordsForSectorBakeDomain(key, SECTOR_STEP)
			const hasMissingVisibleTile = bakeCoords.some(
				(coord) => !this.renderer.game.hasRenderableTerrainAt(coord)
			)
			if (!hasMissingVisibleTile) continue
			const [sectorQ, sectorR] = key.split(',').map(Number)
			queue.push({
				key,
				sectorQ,
				sectorR,
				distanceToCenter: axial.distance(center, this.sectorCenter(sectorQ, sectorR)),
			})
		}
		queue.sort((a, b) => a.distanceToCenter - b.distanceToCenter)
		return queue
	}

	private collectQueuedSectorKeys(): Set<string> {
		if (this.visibleSectorKeys.size === 0) return new Set()

		let minSectorQ = Number.POSITIVE_INFINITY
		let maxSectorQ = Number.NEGATIVE_INFINITY
		let minSectorR = Number.POSITIVE_INFINITY
		let maxSectorR = Number.NEGATIVE_INFINITY
		for (const key of this.visibleSectorKeys) {
			const [sectorQ, sectorR] = key.split(',').map(Number)
			minSectorQ = Math.min(minSectorQ, sectorQ)
			maxSectorQ = Math.max(maxSectorQ, sectorQ)
			minSectorR = Math.min(minSectorR, sectorR)
			maxSectorR = Math.max(maxSectorR, sectorR)
		}

		return this.collectSectorKeys(
			minSectorQ - PREFETCH_SECTOR_MARGIN,
			maxSectorQ + PREFETCH_SECTOR_MARGIN,
			minSectorR - PREFETCH_SECTOR_MARGIN,
			maxSectorR + PREFETCH_SECTOR_MARGIN
		)
	}

	private currentViewportWorldBounds(): WorldBounds {
		const app = this.renderer.app
		const world = this.renderer.world
		if (!app || !world) {
			return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
		}

		const screenCorners = [
			new Point(0, 0),
			new Point(app.screen.width, 0),
			new Point(0, app.screen.height),
			new Point(app.screen.width, app.screen.height),
		]
		const worldCorners = screenCorners.map((corner) => world.toLocal(corner))
		return {
			minX: Math.min(...worldCorners.map((corner) => corner.x)) - VIEWPORT_WORLD_OVERSCAN,
			maxX: Math.max(...worldCorners.map((corner) => corner.x)) + VIEWPORT_WORLD_OVERSCAN,
			minY: Math.min(...worldCorners.map((corner) => corner.y)) - VIEWPORT_WORLD_OVERSCAN,
			maxY: Math.max(...worldCorners.map((corner) => corner.y)) + VIEWPORT_WORLD_OVERSCAN,
		}
	}

	private pumpVisibleSectorQueue() {
		if (this.pendingSectors.size >= MAX_PENDING_SECTORS) return

		let started = 0
		while (
			this.pendingSectors.size < MAX_PENDING_SECTORS &&
			started < MAX_SECTOR_STARTS_PER_REFRESH &&
			this.visibleSectorQueue.length > 0
		) {
			const next = this.visibleSectorQueue.shift()
			if (!next) break
			if (this.pendingSectors.has(next.key)) continue
			void this.requestSectorFrontier(next)
			started++
		}
	}

	private async requestSectorFrontier(next: QueuedSector) {
		const sectorStartedAt = nowMs()
		const pendingSectorCountAtStart = this.pendingSectors.size
		this.pendingSectors.add(next.key)
		let generated = false
		let requestMode: 'ensure' | 'frontier' = 'frontier'
		let missingBakeTiles = 0
		try {
			const bakeCoords = coordsForSectorBakeDomain(next.key, SECTOR_STEP)
			const missingBakeCoords = bakeCoords.filter(
				(coord) => !this.renderer.game.hasRenderableTerrainAt(coord)
			)
			missingBakeTiles = missingBakeCoords.length
			const interiorCoords = this.coordsForSectorKey(next.key)
			if (missingBakeCoords.length > 0) {
				const ensureTerrainSamples = (
					this.renderer.game as {
						ensureTerrainSamples?: (coords: Iterable<AxialCoord>) => Promise<void>
					}
				).ensureTerrainSamples
				if (ensureTerrainSamples) {
					requestMode = 'ensure'
					const ensureCoords = this.visibleSectorKeys.has(next.key)
						? this.collectMissingBakeCoordsForKeys(this.visibleSectorKeys)
						: missingBakeCoords
					await this.renderer.game.ensureTerrainSamples(ensureCoords)
					generated = bakeCoords.every((coord) =>
						this.renderer.game.hasRenderableTerrainAt(coord)
					)
				} else {
					generated = await this.renderer.game.requestGameplayFrontier(
						this.sectorCenter(next.sectorQ, next.sectorR),
						GAMEPLAY_STREAM_RADIUS,
						{ maxBatchSize: GAMEPLAY_STREAM_BATCH_SIZE }
					)
				}
			} else {
				generated = await this.renderer.game.requestGameplayFrontier(
					this.sectorCenter(next.sectorQ, next.sectorR),
					GAMEPLAY_STREAM_RADIUS,
					{ maxBatchSize: GAMEPLAY_STREAM_BATCH_SIZE }
				)
			}
			this.recordSectorDiagnostics(
				next.key,
				countVisibleCoords(interiorCoords, this.visibleTileKeys),
				countMaterializedCoords(interiorCoords, this.visibleTileKeys, this.renderer),
				countMissingCoords(bakeCoords, new Set(bakeCoords.map((coord) => axial.key(coord))), this.renderer),
				pendingSectorCountAtStart,
				0,
				0,
				pendingSectorCountAtStart,
				0,
				0,
				nowMs() - sectorStartedAt
			)
		} catch (error) {
			console.error('[TerrainVisual] Failed to materialize gameplay tiles', error)
		} finally {
			this.queueDebug.recentRequests.unshift({
				sectorKey: next.key,
				mode: requestMode,
				missingBakeTiles,
				generated,
				ms: nowMs() - sectorStartedAt,
			})
			this.queueDebug.recentRequests = this.queueDebug.recentRequests.slice(0, 30)
			this.pendingSectors.delete(next.key)
			if (generated && this.isBound) this.scheduleInvalidate()
		}
	}

	private sectorCenter(sectorQ: number, sectorR: number): AxialCoord {
		return {
			q: sectorQ * SECTOR_STEP + Math.floor(SECTOR_STEP / 2),
			r: sectorR * SECTOR_STEP + Math.floor(SECTOR_STEP / 2),
		}
	}

	private collectMissingBakeCoordsForKeys(keys: Iterable<string>): AxialCoord[] {
		const coords = new Map<string, AxialCoord>()
		for (const sectorKey of keys) {
			for (const coord of coordsForSectorBakeDomain(sectorKey, SECTOR_STEP)) {
				if (this.renderer.game.hasRenderableTerrainAt(coord)) continue
				coords.set(axial.key(coord), coord)
			}
		}
		return [...coords.values()]
	}

	private recordSectorDiagnostics(
		sectorKey: string,
		visibleTileCount: number,
		renderedTileCount: number,
		missingTileCount: number,
		groundBatchCount: number,
		resourceBatchCount: number,
		staticResourceSpriteCount: number,
		pendingSectorCountAtStart: number,
		groundBatchBuildMs: number,
		resourceBatchBuildMs: number,
		totalSectorMs: number
	) {
		const sectorDiagnostics: TerrainSectorDiagnostics = {
			sectorKey,
			visibleTileCount,
			renderedTileCount,
			missingTileCount,
			groundBatchCount,
			resourceBatchCount,
			staticResourceSpriteCount,
			pendingSectorCountAtStart,
			timings: {
				groundBatchBuildMs,
				resourceBatchBuildMs,
				totalSectorMs,
			},
		}

		this.diagnostics.recentSectors.unshift(sectorDiagnostics)
		this.diagnostics.recentSectors = this.diagnostics.recentSectors.slice(
			0,
			TERRAIN_DIAGNOSTIC_HISTORY_LIMIT
		)
		this.diagnostics.totals.sectorsRendered++
		this.diagnostics.totals.groundTextureGroupRenderables += groundBatchCount
		this.diagnostics.totals.groundSectorBatchCount += groundBatchCount > 0 ? 1 : 0
		this.diagnostics.totals.resourceBatchCount += resourceBatchCount
		this.diagnostics.totals.staticResourceSpriteCount += staticResourceSpriteCount
		this.diagnostics.totals.maxSectorTotalMs = Math.max(
			this.diagnostics.totals.maxSectorTotalMs,
			totalSectorMs
		)

		if (totalSectorMs >= SLOW_SECTOR_LOG_THRESHOLD_MS) {
			console.debug('[TerrainVisual] Slow sector render', sectorDiagnostics)
		}
	}
}

function computeWorldBounds(coords: AxialCoord[]) {
	let minX = Number.POSITIVE_INFINITY
	let minY = Number.POSITIVE_INFINITY
	let maxX = Number.NEGATIVE_INFINITY
	let maxY = Number.NEGATIVE_INFINITY
	for (const coord of coords) {
		const world = cartesian(coord, tileSize)
		minX = Math.min(minX, world.x - HEX_HALF_WIDTH)
		maxX = Math.max(maxX, world.x + HEX_HALF_WIDTH)
		minY = Math.min(minY, world.y - HEX_HALF_HEIGHT)
		maxY = Math.max(maxY, world.y + HEX_HALF_HEIGHT)
	}
	if (!Number.isFinite(minX)) {
		return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
	}
	return { minX, minY, maxX, maxY }
}

function countVisibleCoords(coords: Iterable<AxialCoord>, visibleKeys: Set<string>): number {
	let visibleCount = 0
	for (const coord of coords) {
		if (visibleKeys.has(axial.key(coord))) visibleCount++
	}
	return visibleCount
}

function countMaterializedCoords(
	coords: Iterable<AxialCoord>,
	visibleKeys: Set<string>,
	renderer: PixiGameRenderer
): number {
	let visibleCount = 0
	for (const coord of coords) {
		if (!visibleKeys.has(axial.key(coord))) continue
		if (renderer.game.hasRenderableTerrainAt(coord)) visibleCount++
	}
	return visibleCount
}

function countMissingCoords(
	coords: Iterable<AxialCoord>,
	visibleKeys: Set<string>,
	renderer: PixiGameRenderer
): number {
	let visibleCount = 0
	for (const coord of coords) {
		if (!visibleKeys.has(axial.key(coord))) continue
		if (!renderer.game.hasRenderableTerrainAt(coord)) visibleCount++
	}
	return visibleCount
}

function countMaterializedVisibleTiles(
	visibleKeys: Set<string>,
	renderer: PixiGameRenderer
): number {
	let count = 0
	for (const key of visibleKeys) {
		if (renderer.game.hasRenderableTerrainAt(axial.coord(key))) count++
	}
	return count
}

function countMatchingKeys(keys: Set<string>, loaded: Map<string, unknown> | Set<string>): number {
	let count = 0
	for (const key of keys) {
		if (loaded.has(key)) count++
	}
	return count
}

function setsEqual<T>(left: Set<T>, right: Set<T>): boolean {
	if (left.size !== right.size) return false
	for (const value of left) {
		if (!right.has(value)) return false
	}
	return true
}

function collectVisibleTileKeys(
	center: AxialCoord,
	radius: number,
	viewportBounds: WorldBounds
): Set<string> {
	const visibleKeys = new Set<string>()
	for (const coord of axial.allTiles(center, radius)) {
		if (!tileIntersectsWorldBounds(coord, viewportBounds)) continue
		visibleKeys.add(axial.key(coord))
	}
	return visibleKeys
}

function collectVisibleSectorKeys(visibleTileKeys: Set<string>): Set<string> {
	const sectorKeys = new Set<string>()
	for (const key of visibleTileKeys) {
		const coord = axial.coord(key)
		sectorKeys.add(sectorKeyForCoord(coord, SECTOR_STEP))
	}
	return sectorKeys
}

function tileIntersectsWorldBounds(coord: AxialCoord, bounds: WorldBounds): boolean {
	const center = cartesian(coord, tileSize)
	return !(
		center.x + HEX_HALF_WIDTH < bounds.minX ||
		center.x - HEX_HALF_WIDTH > bounds.maxX ||
		center.y + HEX_HALF_HEIGHT < bounds.minY ||
		center.y - HEX_HALF_HEIGHT > bounds.maxY
	)
}

function nowMs(): number {
	return globalThis.performance?.now() ?? Date.now()
}

export { TerrainVisual as ContinuousTerrainLayer }
