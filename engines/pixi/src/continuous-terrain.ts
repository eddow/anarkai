import { mrg } from '@app/lib/interactive-state'
import { defer, effect, type ScopedCallback } from 'mutts'
import {
	Container,
	Graphics,
	Particle,
	ParticleContainer,
	Point,
	Rectangle,
	Sprite,
	Texture,
} from 'pixi.js'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { profile } from 'ssh/dev/debug'
import type { RenderableTerrainTile } from 'ssh/game/game'
import type { TerrainMacroHydrologySnapshot } from 'engine-terrain'
import { type AxialCoord, axial, cartesian, fromCartesian, toAxialCoord } from 'ssh/utils'
import { tileSize } from 'ssh/utils/varied'
import { setPixiName } from './debug-names'
import type { PixiGameRenderer } from './renderer'
import { RoadTileTextureCache } from './road-tile-texture'
import {
	buildStaticResourceSpriteSpecs,
	buildStaticResourceSpriteSpecsFromTerrainSample,
	resolveUsableTexture,
} from './renderers/static-resource-sprites'
import {
	type SectorTerrainBakeDebug,
	type SectorTerrainBakeInput,
	SectorTerrainBaker,
	type TerrainLodMode,
} from './terrain-sector-baker'
import {
	coordsForSectorBakeDomain,
	coordsForSectorInterior,
	createSectorCoverage,
	sectorKeyForCoord,
	sectorsAffectedByTile,
	terrainSectorStep,
} from './terrain-sector-topology'

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
// Batch size for terrain generation streaming.
// Larger batches amortize WASM boundary overhead vs one-at-a-time generation.
// Sectors are 17×17=289 tiles; 512 fits 2 sectors comfortably with padding.
const GAMEPLAY_STREAM_BATCH_SIZE = 512
const TERRAIN_DIAGNOSTIC_HISTORY_LIMIT = 12
const SLOW_SECTOR_LOG_THRESHOLD_MS = 16
const MAX_PENDING_SECTORS = 12 // Increased for better panning performance
const MAX_SECTOR_STARTS_PER_REFRESH = 12 // Increased for faster sector loading
const VIEWPORT_SETTLE_MS = 150 // Reduced for faster response during panning
const VIEWPORT_WORLD_OVERSCAN = tileSize * 3
const REFRESH_THROTTLE_MS = 8 // Throttle heavy refresh operations during panning
const HEX_HALF_WIDTH = (Math.sqrt(3) / 2) * tileSize
const HEX_HALF_HEIGHT = tileSize
const USE_PARTICLE_RESOURCE_BATCH = false
const TERRAIN_PROFILE_CHANNEL = 'terrainVisual'
const DETAIL_LOD_MIN_TILE_PIXELS = 48
const TEXTURE_LOD_MIN_TILE_PIXELS = 36
const OVERVIEW_FINE_LOD_MIN_TILE_PIXELS = 24
const OVERVIEW_MEDIUM_LOD_MIN_TILE_PIXELS = 16
const OVERVIEW_COARSE_LOD_MIN_TILE_PIXELS = 8
const OVERVIEW_DISTANT_LOD_MIN_TILE_PIXELS = 4
const MACRO_OVERVIEW_RADIUS_MARGIN_SECTORS = 1
// Macro regions are cached around snapped sector centers in TerrainProvider.
// A camera can drift almost one snap cell away from that generation center
// before the cache key changes, so include that drift in requested coverage.
const MACRO_OVERVIEW_SNAP_DRIFT_SECTORS = 8
const MACRO_OVERVIEW_MAX_GRID_RADIUS = 120
const MACRO_OVERVIEW_MIN_SECTOR_RADIUS = 4
let loggedNonDetailResourceMode = false

export function terrainLodTilePixels(worldScale: number): number {
	return tileSize * 2 * Math.max(0, worldScale)
}

export function resolveTerrainLod(worldScale: number): TerrainLodMode {
	const tilePixels = terrainLodTilePixels(worldScale)
	if (tilePixels >= DETAIL_LOD_MIN_TILE_PIXELS) return 'detail'
	if (tilePixels >= TEXTURE_LOD_MIN_TILE_PIXELS) return 'texture'
	if (tilePixels >= OVERVIEW_FINE_LOD_MIN_TILE_PIXELS) return 'overview-fine'
	if (tilePixels >= OVERVIEW_MEDIUM_LOD_MIN_TILE_PIXELS) return 'overview-medium'
	if (tilePixels >= OVERVIEW_COARSE_LOD_MIN_TILE_PIXELS) return 'overview-coarse'
	if (tilePixels >= OVERVIEW_DISTANT_LOD_MIN_TILE_PIXELS) return 'overview-distant'
	return 'macro'
}

function usesMacroOverview(lodMode: TerrainLodMode): boolean {
	return (
		lodMode === 'overview-fine' ||
		lodMode === 'overview-medium' ||
		lodMode === 'overview-coarse' ||
		lodMode === 'overview-distant' ||
		lodMode === 'macro' ||
		lodMode === 'material'
	)
}

function includesDetailedHydrology(lodMode: TerrainLodMode): boolean {
	return lodMode === 'detail' || lodMode === 'texture'
}

export function macroStepForTerrainLod(lodMode: TerrainLodMode): number {
	if (lodMode === 'overview-fine') return 1
	if (lodMode === 'overview-medium') return 2
	if (lodMode === 'overview-coarse') return 4
	if (lodMode === 'overview-distant') return 8
	if (lodMode === 'macro') return 8
	return 8
}

export interface TerrainMacroRequest {
	macroStep: number
	sectorRadius: number
}

export function macroRequestForTerrainLod(
	lodMode: TerrainLodMode,
	viewportTileRadius: number
): TerrainMacroRequest {
	const sectorRadius = Math.max(
		MACRO_OVERVIEW_MIN_SECTOR_RADIUS,
		Math.ceil(viewportTileRadius / SECTOR_STEP) +
			MACRO_OVERVIEW_RADIUS_MARGIN_SECTORS +
			MACRO_OVERVIEW_SNAP_DRIFT_SECTORS
	)
	const baseStep = macroStepForTerrainLod(lodMode)
	const coverageTiles = sectorRadius * SECTOR_STEP
	const boundedStep = Math.ceil(coverageTiles / MACRO_OVERVIEW_MAX_GRID_RADIUS)
	return {
		sectorRadius,
		macroStep: Math.max(baseStep, boundedStep),
	}
}

function snappedMacroSectorKey(centerSectorKey: string): string {
	const [rawQ, rawR] = centerSectorKey.split(',').map(Number)
	const q = Math.floor((rawQ ?? 0) / MACRO_OVERVIEW_SNAP_DRIFT_SECTORS) * MACRO_OVERVIEW_SNAP_DRIFT_SECTORS
	const r = Math.floor((rawR ?? 0) / MACRO_OVERVIEW_SNAP_DRIFT_SECTORS) * MACRO_OVERVIEW_SNAP_DRIFT_SECTORS
	return `${q},${r}`
}

function macroSnapshotMatchesRequest(
	snapshot: TerrainMacroHydrologySnapshot,
	centerSectorKey: string,
	request: TerrainMacroRequest
): boolean {
	return (
		`${snapshot.centerSector.q},${snapshot.centerSector.r}` === snappedMacroSectorKey(centerSectorKey) &&
		snapshot.sectorRadius === request.sectorRadius &&
		snapshot.macroStep === request.macroStep
	)
}

function beginTerrainProfile(label: string, payload?: unknown): (payload?: unknown) => void {
	return profile[TERRAIN_PROFILE_CHANNEL].begin?.(label, payload) ?? (() => {})
}

export interface TerrainSectorDiagnostics {
	sectorKey: string
	lodMode: TerrainLodMode
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
	lodMode: TerrainLodMode
	tilePixels: number
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
		skippedResourceSectorCount: number
		materialSectorBakeCount: number
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
		macroCacheSize?: number
		macroInFlightSize?: number
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
		mode: 'gameplay-sector' | 'frontier'
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
	groundTexture?: Texture
	coverage: ReturnType<typeof createSectorCoverage>
	dirty: boolean
	resourcesBuilt: boolean
	lodMode?: TerrainLodMode
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

function macroTerrainColor(biome: string, height: number): number {
	if (biome === 'ocean' || biome === 'lake') return height < -0.15 ? 0x275f8f : 0x3b82ad
	if (biome === 'snow') return 0xd6e1df
	if (biome === 'rocky') return 0x6f756b
	if (biome === 'sand') return 0xbca967
	if (biome === 'forest') return 0x356f3a
	if (biome === 'wetland') return 0x477457
	if (biome === 'river-bank') return 0x5f7f49
	return height > 0.25 ? 0x6b8743 : 0x5f8f4a
}

export class TerrainVisual {
	private static viewportSequence = 0
	private readonly container = setPixiName(new Container(), 'terrain.continuous')
	private readonly macroTerrainOverlay = setPixiName(new Graphics(), 'terrain.continuous:macro-terrain')
	private readonly macroRiverOverlay = setPixiName(new Graphics(), 'terrain.continuous:macro-rivers')
	private readonly macroRoadOverlay = setPixiName(new Graphics(), 'terrain.continuous:macro-roads')
	private readonly sectorsContainer = setPixiName(new Container(), 'terrain.continuous:sectors')
	private readonly hoverOverlay = setPixiName(new Graphics(), 'terrain.continuous:hover')
	private isBound = false
	private lastSignature = ''
	private readonly sectors = new Map<string, SectorVisualState>()
	private readonly sectorCoords = new Map<string, AxialCoord[]>()
	private readonly pendingSectors = new Set<string>()
	private readonly dirtySectorKeys = new Set<string>()
	private readonly terrainBaker: SectorTerrainBaker
	private readonly roadTileTextures: RoadTileTextureCache
	private readonly bakeDebugBySector = new Map<string, SectorTerrainBakeDebug>()
	private visibleTileKeys = new Set<string>()
	private visibleSectorKeys = new Set<string>()
	private visibleSectorQueue: QueuedSector[] = []
	private currentLodMode: TerrainLodMode = 'detail'
	private viewportSettleSignature = ''
	private viewportChangedAtMs = 0
	private lastMacroOverlaySignature = ''
	private refreshScheduled = false
	private refreshScheduledClearCache = false
	private lastRefreshTime = 0
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
			lodMode: 'detail',
			tilePixels: terrainLodTilePixels(1),
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
			skippedResourceSectorCount: 0,
			materialSectorBakeCount: 0,
			maxSectorTotalMs: 0,
		},
	}
	private hoverCleanup?: ScopedCallback
	private roadsCleanup?: () => void

	constructor(private readonly renderer: PixiGameRenderer) {
		this.terrainBaker = new SectorTerrainBaker(renderer)
		this.roadTileTextures = new RoadTileTextureCache(renderer)
		this.container.eventMode = 'none'
		this.macroTerrainOverlay.eventMode = 'none'
		this.macroRiverOverlay.eventMode = 'none'
		this.macroRoadOverlay.eventMode = 'none'
		this.sectorsContainer.eventMode = 'none'
		this.hoverOverlay.eventMode = 'none'
		this.container.addChild(
			this.macroTerrainOverlay,
			this.macroRiverOverlay,
			this.macroRoadOverlay,
			this.sectorsContainer,
			this.hoverOverlay
		)
	}

	public bind() {
		this.isBound = true
		this.renderer.worldScene.addChild(this.container)
		this.renderer.attachToLayer(this.renderer.layers.ground, this.container)
		this.renderer.app?.ticker.add(this.refresh)
		this.hoverCleanup = effect`terrain.hover`(() => {
			this.renderHoverOverlay(
				isHoveredTileObject(mrg.hoveredObject) ? mrg.hoveredObject : undefined
			)
		})
		const onRoadsChanged = (coords: AxialCoord[]) => this.invalidateRoadTiles(coords)
		this.renderer.game.on({ roadsChanged: onRoadsChanged })
		this.roadsCleanup = () => this.renderer.game.off({ roadsChanged: onRoadsChanged })
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
		this.roadsCleanup?.()
		this.roadsCleanup = undefined
		this.roadTileTextures.clear()
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
		const affectedSectorKeys = sectorsAffectedByTile(coord, SECTOR_STEP)
		for (const sectorKey of affectedSectorKeys) {
			if (clearCache) {
				this.destroySectorByKey(sectorKey)
				continue
			}
			this.dirtySectorKeys.add(sectorKey)
			const state = this.sectors.get(sectorKey)
			if (state) state.dirty = true
		}
		this.scheduleInvalidate(false)
	}

	private invalidateRoadTiles(coords: readonly AxialCoord[]): void {
		if (coords.length === 0) {
			this.roadTileTextures.clear()
			this.invalidate()
			return
		}
		this.roadTileTextures.invalidate(coords)
		for (const coord of coords) this.invalidateAt(coord)
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
		
		// Compute viewport settled status first for throttling
		const screenCenter = new Point(app.screen.width / 2, app.screen.height / 2)
		const localCenter = world.toLocal(screenCenter)
		const center = axial.round(fromCartesian(localCenter, tileSize))
		const worldPosition = world.position ?? { x: 0, y: 0 }
		const viewportSettled = refreshStartedAt - this.viewportChangedAtMs >= VIEWPORT_SETTLE_MS
		
		// Throttle refresh operations during rapid panning
		const timeSinceLastRefresh = refreshStartedAt - this.lastRefreshTime
		if (timeSinceLastRefresh < REFRESH_THROTTLE_MS && !viewportSettled) {
			// Skip heavy operations during rapid movement, just pump queue
			this.pumpVisibleSectorQueue()
			this.lastRefreshTime = refreshStartedAt
			return
		}
		this.lastRefreshTime = refreshStartedAt

		const endRefreshProfile = beginTerrainProfile('refresh')
		const lodMode = resolveTerrainLod(world.scale.x)
		this.currentLodMode = lodMode
		const macroOverview = usesMacroOverview(lodMode)
		const tilePixels = terrainLodTilePixels(world.scale.x)
		const worldHalfWidth = app.screen.width / (2 * Math.max(world.scale.x, 0.001))
		const worldHalfHeight = app.screen.height / (2 * Math.max(world.scale.y, 0.001))
		const radius = Math.ceil(Math.max(worldHalfWidth, worldHalfHeight) / tileSize) + 6
		
		// Optimize signature calculation - use fewer decimal places for faster comparison
		const signature = `${center.q},${center.r}:${radius}:${app.screen.width}x${app.screen.height}:${lodMode}:${world.scale.x.toFixed(2)},${world.scale.y.toFixed(2)}:${Math.round(worldPosition.x)},${Math.round(worldPosition.y)}`
		if (signature !== this.viewportSettleSignature) {
			this.viewportSettleSignature = signature
			this.viewportChangedAtMs = refreshStartedAt
		}
		const currentViewportSettled = refreshStartedAt - this.viewportChangedAtMs >= VIEWPORT_SETTLE_MS
		if (signature === this.lastSignature) {
			if (!macroOverview && currentViewportSettled) this.pumpVisibleSectorQueue()
			endRefreshProfile({
				skipped: true,
				lodMode,
				scale: world.scale.x,
				tilePixels,
				radius,
				screen: `${app.screen.width}x${app.screen.height}`,
			})
			return
		}
		this.lastSignature = signature
		const refreshProfilePayload = {
			lodMode,
			scale: world.scale.x,
			tilePixels,
			radius,
			screen: `${app.screen.width}x${app.screen.height}`,
			macroOverview,
		}

		const minQ = center.q - radius
		const maxQ = center.q + radius
		const minR = center.r - radius
		const maxR = center.r + radius
		const endVisibilityProfile = beginTerrainProfile('refresh.visibility', refreshProfilePayload)
		const viewportBounds = this.currentViewportWorldBounds()
		this.visibleTileKeys = collectVisibleTileKeys(center, radius + 2, viewportBounds)
		this.visibleSectorKeys = macroOverview
			? new Set()
			: collectVisibleSectorKeys(this.visibleTileKeys)
		endVisibilityProfile({
			visibleTiles: this.visibleTileKeys.size,
			visibleSectors: this.visibleSectorKeys.size,
		})
		this.diagnostics.refresh.lodMode = lodMode
		this.diagnostics.refresh.tilePixels = tilePixels
		if (macroOverview) {
			const request = macroRequestForTerrainLod(lodMode, radius)
			const endMacroRequestProfile = beginTerrainProfile('refresh.macroRequest', {
				...refreshProfilePayload,
				...request,
			})
			this.ensureAndRenderMacroHydrology(center, request)
			this.renderMacroRoadOverlay()
			endMacroRequestProfile(request)
		} else {
			this.macroTerrainOverlay.visible = false
			this.macroRiverOverlay.visible = false
			this.macroRoadOverlay.visible = false
		}
		const streamDetailSectors = !macroOverview

		const endRetentionProfile = beginTerrainProfile('refresh.retention', refreshProfilePayload)
		const sectorMinQ = Math.floor(minQ / SECTOR_STEP)
		const sectorMaxQ = Math.floor(maxQ / SECTOR_STEP)
		const sectorMinR = Math.floor(minR / SECTOR_STEP)
		const sectorMaxR = Math.floor(maxR / SECTOR_STEP)
		const retainedSectorKeys = streamDetailSectors
			? this.collectSectorKeys(
					sectorMinQ - RETAINED_SECTOR_MARGIN,
					sectorMaxQ + RETAINED_SECTOR_MARGIN,
					sectorMinR - RETAINED_SECTOR_MARGIN,
					sectorMaxR + RETAINED_SECTOR_MARGIN
				)
			: new Set(this.sectors.keys())
		endRetentionProfile({
			retainedSectors: retainedSectorKeys.size,
			loadedSectors: this.sectors.size,
			streamDetailSectors,
		})

		const endSectorLifecycleProfile = beginTerrainProfile('refresh.sectorLifecycle', {
			retainedSectors: retainedSectorKeys.size,
			loadedSectors: this.sectors.size,
			streamDetailSectors,
		})
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
		endSectorLifecycleProfile({
			loadedSectors: this.sectors.size,
			sectorCoordCache: this.sectorCoords.size,
		})

		const endSyncProfile = beginTerrainProfile('refresh.syncVisuals', {
			visibleTiles: this.visibleTileKeys.size,
			visibleSectors: this.visibleSectorKeys.size,
			streamDetailSectors,
		})
		const materializedVisibleTileCount = countMaterializedVisibleTiles(
			this.visibleTileKeys,
			this.renderer
		)
		if (streamDetailSectors) this.syncLoadedSectorVisuals()
		else this.hideLoadedSectorVisuals()
		endSyncProfile({
			materializedVisibleTileCount,
			loadedSectors: this.sectors.size,
		})

		const endQueueProfile = beginTerrainProfile('refresh.queue', {
			visibleSectors: this.visibleSectorKeys.size,
			streamDetailSectors,
		})
		this.visibleSectorQueue = streamDetailSectors ? this.buildVisibleSectorQueue(center) : []
		if (streamDetailSectors && currentViewportSettled) {
			this.pumpVisibleSectorQueue()
		} else {
			if (!streamDetailSectors) {
				this.queueDebug.selection.prefetchSectorKeys = []
				this.queueDebug.selection.queuedVisibleKeys = []
				this.queueDebug.selection.queuedPrefetchKeys = []
				this.queueDebug.queue = { total: 0, visibleCount: 0, prefetchCount: 0, topKeys: [] }
			}
		}
		endQueueProfile({
			queuedVisibleSectorCount: this.visibleSectorQueue.length,
			pendingSectorCount: this.pendingSectors.size,
		})

		const loadedVisibleSectorCount = countMatchingKeys(this.visibleSectorKeys, this.sectors)
		const missingVisibleSectorCount =
			this.visibleSectorKeys.size - loadedVisibleSectorCount + this.visibleSectorQueue.length

		this.diagnostics.refresh = {
			center,
			radius,
			lodMode,
			tilePixels,
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
		const endDemandProfile = beginTerrainProfile('refresh.viewportDemand', {
			lodMode,
			macroOverview,
			visibleSectors: this.visibleSectorKeys.size,
			prefetchSectors: this.queueDebug.selection.prefetchSectorKeys.length,
		})
		this.updateViewportDemand()
		endDemandProfile(this.queueDebug.provider)
		endRefreshProfile(this.diagnostics.refresh)
	}

	private ensureAndRenderMacroHydrology(center: AxialCoord, request: TerrainMacroRequest): void {
		const endEnsureProfile = beginTerrainProfile('macro.ensureAndRender', {
			center: axial.key(center),
			...request,
		})
		this.macroTerrainOverlay.visible = true
		this.macroRiverOverlay.visible = true
		const centerSectorKey = sectorKeyForCoord(center, SECTOR_STEP)
		const ensureMacroHydrology = (
			this.renderer.game as {
				ensureMacroHydrology?: (
					centerSectorKey: string,
					options?: { macroStep?: number; sectorRadius?: number }
				) => Promise<void>
			}
		).ensureMacroHydrology
		const getTerrainMacroHydrology = (
			this.renderer.game as {
				getTerrainMacroHydrology?: () => TerrainMacroHydrologySnapshot | undefined
			}
		).getTerrainMacroHydrology
		const current = getTerrainMacroHydrology?.call(this.renderer.game)
		if (current && macroSnapshotMatchesRequest(current, centerSectorKey, request)) {
			this.renderMacroRiverOverlay(current)
		}
		if (!ensureMacroHydrology) {
			endEnsureProfile({ hasCurrent: !!current, requested: false })
			return
		}
		void ensureMacroHydrology.call(this.renderer.game, centerSectorKey, request).then(() => {
			const next = getTerrainMacroHydrology?.call(this.renderer.game)
			if (next && macroSnapshotMatchesRequest(next, centerSectorKey, request)) {
				this.renderMacroRiverOverlay(next)
			}
			endEnsureProfile({
				hasCurrent: !!current,
				hasNext: !!next,
				macroTiles: next?.macroTileCount,
				riverSegments: next?.riverSegmentCount,
				macroStep: next?.macroStep,
				sectorRadius: next?.sectorRadius,
			})
		})
	}

	private renderMacroRiverOverlay(snapshot: TerrainMacroHydrologySnapshot): void {
		const endMacroRenderProfile = beginTerrainProfile('macro.render', {
			macroStep: snapshot.macroStep,
			sectorRadius: snapshot.sectorRadius,
			tiles: snapshot.tiles.length,
			segments: snapshot.segments.length,
		})
		const signature = `${snapshot.seed}:${snapshot.centerSector.q},${snapshot.centerSector.r}:${snapshot.sectorRadius}:${snapshot.macroStep}:${snapshot.tiles.length}:${snapshot.segments.length}:${this.renderer.world.scale.x.toFixed(3)}`
		if (signature === this.lastMacroOverlaySignature) {
			endMacroRenderProfile({ skipped: true })
			return
		}
		this.lastMacroOverlaySignature = signature
		this.renderMacroTerrainOverlay(snapshot)
		const graphics = this.macroRiverOverlay
		graphics.clear()
		for (const segment of snapshot.segments) {
			const from = cartesian({ q: segment.fromQ, r: segment.fromR }, tileSize)
			const to = cartesian({ q: segment.toQ, r: segment.toR }, tileSize)
			const width = Math.max(
				this.screenStrokeWorld(2.25, 1.5, tileSize * 0.65),
				Math.min(7, segment.width * 0.75 + segment.order * 0.35)
			)
			graphics
				.moveTo(from.x, from.y)
				.lineTo(to.x, to.y)
				.stroke({ width, color: 0x2586d7, alpha: 0.62, cap: 'round', join: 'round' })
		}
		endMacroRenderProfile({
			terrainTiles: snapshot.tiles.length,
			riverSegments: snapshot.segments.length,
		})
	}

	private renderMacroTerrainOverlay(snapshot: TerrainMacroHydrologySnapshot): void {
		const endTerrainProfile = beginTerrainProfile('macro.renderTerrain', {
			macroStep: snapshot.macroStep,
			sectorRadius: snapshot.sectorRadius,
			tiles: snapshot.tiles.length,
		})
		const graphics = this.macroTerrainOverlay
		graphics.clear()
		const radius = tileSize * snapshot.macroStep
		for (const tile of snapshot.tiles) {
			const center = cartesian({ q: tile.q, r: tile.r }, tileSize)
			const points: number[] = []
			for (let corner = 0; corner < 6; corner++) {
				const angle = Math.PI / 6 + corner * Math.PI / 3
				points.push(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius)
			}
			graphics.poly(points).fill({ color: macroTerrainColor(tile.biome, tile.height), alpha: 0.92 })
		}
		endTerrainProfile({ tiles: snapshot.tiles.length })
	}

	private screenStrokeWorld(screenPixels: number, minWorld: number, maxWorld: number): number {
		const scale = Math.max(0.001, this.renderer.world.scale.x)
		return Math.max(minWorld, Math.min(maxWorld, screenPixels / scale))
	}

	private renderMacroRoadOverlay(): void {
		this.macroRoadOverlay.visible = true
		const graphics = this.macroRoadOverlay
		graphics.clear()
		const hex = this.renderer.game.hex
		if (!hex) return
		const width = this.screenStrokeWorld(2, 2, tileSize * 0.45)
		for (const segment of hex.roadSegments()) {
			const border = hex.getBorder(segment.coord)
			if (!border) continue
			const fromCoord = toAxialCoord(border.tile.a.position)
			const toCoord = toAxialCoord(border.tile.b.position)
			if (!fromCoord || !toCoord) continue
			const from = cartesian(fromCoord, tileSize)
			const to = cartesian(toCoord, tileSize)
			graphics
				.moveTo(from.x, from.y)
				.lineTo(to.x, to.y)
				.stroke({ width, color: 0xa9784d, alpha: 0.78, cap: 'round', join: 'round' })
		}
	}

	private clearSectors() {
		for (const sector of this.sectors.values()) this.destroySectorVisualState(sector)
		this.sectors.clear()
		this.sectorCoords.clear()
		this.visibleSectorKeys.clear()
		this.visibleSectorQueue = []
		this.bakeDebugBySector.clear()
	}

	private destroySectorByKey(sectorKey: string) {
		const sector = this.sectors.get(sectorKey)
		if (sector) {
			this.destroySectorVisualState(sector)
			this.sectors.delete(sectorKey)
		}
		this.sectorCoords.delete(sectorKey)
		this.dirtySectorKeys.delete(sectorKey)
		this.bakeDebugBySector.delete(sectorKey)
		this.visibleSectorQueue = this.visibleSectorQueue.filter((queued) => queued.key !== sectorKey)
	}

	private destroySectorGroundTexture(sectorState: SectorVisualState) {
		const texture = sectorState.groundTexture
		sectorState.groundTexture = undefined
		if (!texture || texture === Texture.WHITE) return
		texture.destroy(true)
	}

	private destroySectorVisualState(sectorState: SectorVisualState) {
		if (this.renderer.layers?.resources) {
			this.renderer.detachFromLayer(this.renderer.layers.resources, sectorState.resourceLayer)
		}
		this.destroySectorGroundTexture(sectorState)
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
			lodMode: undefined,
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

	private hideLoadedSectorVisuals() {
		for (const sectorState of this.sectors.values()) sectorState.container.visible = false
	}

	private renderSectorVisuals(
		sectorKey: string,
		sectorState: SectorVisualState
	): { renderedTileCount: number; missingTileCount: number } {
		const sectorStartedAt = nowMs()
		const lodMode = this.diagnostics.refresh.lodMode
		const lodChanged = sectorState.lodMode !== lodMode
		
		// Early exit if sector is not visible
		if (!this.visibleSectorKeys.has(sectorKey)) {
			sectorState.container.visible = false
			return { renderedTileCount: 0, missingTileCount: 0 }
		}
		
		// Cache visible coords to avoid repeated filtering
		const visibleCoords = sectorState.coverage.interiorTileCoords.filter((coord) =>
			this.visibleTileKeys.has(axial.key(coord))
		)
		
		// Count missing tiles more efficiently with early exit
		let missingTileCount = 0
		for (const coord of sectorState.coverage.bakeTileCoords) {
			if (!this.renderer.game.hasRenderableTerrainAt(coord)) {
				missingTileCount++
				// Early exit if we already know we need to regenerate
				if (missingTileCount > 0 && !sectorState.groundSprite) break
			}
		}
		
		const shouldBuildResources = lodMode === 'detail'
		if (!shouldBuildResources && !loggedNonDetailResourceMode) {
			loggedNonDetailResourceMode = true
			console.info(
				`[terrain:diagnostic] Resource sprites disabled for LOD=${lodMode}. Macro/overview loose goods visibility depends on viewport-demand materialization.`
			)
		}
		const isDirty = sectorState.dirty || this.dirtySectorKeys.has(sectorKey) || lodChanged
		
		// Only count materialized coords if we need to rebuild or update visibility
		let renderedTileCount = 0
		if (isDirty || missingTileCount > 0 || !sectorState.groundSprite) {
			renderedTileCount = countMaterializedCoords(
				visibleCoords,
				this.visibleTileKeys,
				this.renderer
			)
		} else {
			// Use cached value if nothing changed
			renderedTileCount = visibleCoords.length
		}
		
		if (missingTileCount > 0) {
			sectorState.container.visible = !!sectorState.groundSprite && renderedTileCount > 0
			return {
				renderedTileCount,
				missingTileCount,
			}
		}
		if (
			!isDirty &&
			missingTileCount === 0 &&
			sectorState.groundSprite &&
			(!shouldBuildResources || sectorState.resourcesBuilt)
		) {
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
		const { resourceBatchCount, staticResourceSpriteCount } = shouldBuildResources
			? this.rebuildSectorResources(sectorKey, sectorState)
			: this.clearSectorResources(sectorState)
		const resourceBatchBuildMs = nowMs() - resourceStartedAt

		sectorState.container.visible = renderedTileCount > 0
		sectorState.dirty = false
		sectorState.lodMode = lodMode
		this.dirtySectorKeys.delete(sectorKey)

		const totalSectorMs = nowMs() - sectorStartedAt
		this.recordSectorDiagnostics(
			sectorKey,
			lodMode,
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

	private rebuildSectorGround(sectorKey: string, sectorState: SectorVisualState): number {
		const lodMode = this.diagnostics.refresh.lodMode
		if (
			!sectorState.dirty &&
			!this.dirtySectorKeys.has(sectorKey) &&
			sectorState.lodMode === lodMode &&
			sectorState.groundSprite
		) {
			return 1
		}

		this.destroySectorGroundTexture(sectorState)
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
			lodMode,
			includeRivers: includesDetailedHydrology(lodMode),
			roadTileTextures: lodMode === 'detail' ? this.roadTileTextures : undefined,
			roadLineSegments: lodMode === 'texture' ? this.renderer.game.hex?.roadSegments() : undefined,
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
		sprite.position.set(sectorState.coverage.displayBounds.x, sectorState.coverage.displayBounds.y)
		sectorState.groundLayer.addChild(sprite)
		sectorState.groundSprite = sprite
		sectorState.groundTexture = generatedTexture
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
				const specs = buildStaticResourceSpriteSpecsFromTerrainSample(
					coord,
					terrainSample,
					(spec) => resolveUsableTexture(this.renderer, spec)
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

	private clearSectorResources(
		sectorState: SectorVisualState
	): { resourceBatchCount: number; staticResourceSpriteCount: number } {
		for (const child of sectorState.resourceLayer.removeChildren()) {
			child.destroy({ children: true })
		}
		sectorState.resourcesBuilt = false
		return { resourceBatchCount: 0, staticResourceSpriteCount: 0 }
	}

	private coordsForSectorKey(sectorKey: string): AxialCoord[] {
		const cached = this.sectorCoords.get(sectorKey)
		if (cached) return cached
		const coords = getCachedSectorInteriorCoords(sectorKey, SECTOR_STEP)
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
		const queue = [...visibleQueue]
		this.queueDebug.selection.prefetchSectorKeys = []
		this.queueDebug.selection.queuedVisibleKeys = visibleQueue.map((entry) => entry.key)
		this.queueDebug.selection.queuedPrefetchKeys = []
		this.queueDebug.queue = {
			total: queue.length,
			visibleCount: visibleQueue.length,
			prefetchCount: 0,
			topKeys: queue.slice(0, 20).map((entry) => entry.key),
		}
		return queue
	}

	private updateViewportDemand() {
		if (usesMacroOverview(this.currentLodMode)) {
			const demandedCoords = new Map<string, AxialCoord>()
			for (const tileKey of this.visibleTileKeys) {
				demandedCoords.set(tileKey, axial.coord(tileKey))
			}
			;(
				this.renderer.game as {
					updateTerrainViewportDemand?: (viewportId: string, coords: Iterable<AxialCoord>) => void
				}
			).updateTerrainViewportDemand?.(this.viewportId, demandedCoords.values())
			return
		}
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
			const interiorCoords = this.coordsForSectorKey(key)
			const hasMissingGameplayTile = interiorCoords.some(
				(coord) => !this.hasGameplayContentAt(coord)
			)
			if (!hasMissingGameplayTile) continue
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

	private hasGameplayContentAt(coord: AxialCoord): boolean {
		const hasGameplayContent = (
			this.renderer.game as {
				hasGameplayContentAt?: (coord: AxialCoord) => boolean
			}
		).hasGameplayContentAt
		return hasGameplayContent
			? hasGameplayContent.call(this.renderer.game, coord)
			: this.renderer.game.hasRenderableTerrainAt(coord)
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

		const batch: QueuedSector[] = []
		while (
			this.pendingSectors.size < MAX_PENDING_SECTORS &&
			batch.length < MAX_SECTOR_STARTS_PER_REFRESH &&
			this.visibleSectorQueue.length > 0
		) {
			const next = this.visibleSectorQueue.shift()
			if (!next) break
			if (this.pendingSectors.has(next.key)) continue
			this.pendingSectors.add(next.key)
			batch.push(next)
		}
		if (batch.length === 1) void this.requestSectorFrontier(batch[0]!)
		else if (batch.length > 0) void this.requestSectorFrontierBatch(batch)
	}

	private async requestSectorFrontier(next: QueuedSector) {
		if (!this.pendingSectors.has(next.key)) this.pendingSectors.add(next.key)
		await this.requestSectorFrontierBatch([next])
	}

	private async requestSectorFrontierBatch(batch: QueuedSector[]) {
		const batchStartedAt = nowMs()
		const pendingSectorCountAtStart = this.pendingSectors.size
		const requestInfo = new Map<
			string,
			{
				generated: boolean
				requestMode: 'gameplay-sector' | 'frontier'
				missingBakeTiles: number
			}
		>()
		for (const next of batch) {
			requestInfo.set(next.key, {
				generated: false,
				requestMode: 'frontier',
				missingBakeTiles: 0,
			})
		}
		try {
			const sectorsNeedingTerrain: string[] = []
			const sectorsNeedingBake: string[] = []
			for (const next of batch) {
				const interiorCoords = this.coordsForSectorKey(next.key)
				const bakeCoords = coordsForSectorBakeDomain(next.key, SECTOR_STEP)
				const missingGameplayCoords = interiorCoords.filter(
					(coord) => !this.hasGameplayContentAt(coord)
				)
				const missingBakeCoords = bakeCoords.filter(
					(coord) => !this.renderer.game.hasRenderableTerrainAt(coord)
				)
				const info = requestInfo.get(next.key)!
				info.missingBakeTiles = missingBakeCoords.length
				if (missingGameplayCoords.length > 0) sectorsNeedingTerrain.push(next.key)
				if (missingBakeCoords.length > 0) sectorsNeedingBake.push(next.key)
			}

			if (sectorsNeedingTerrain.length > 0) {
				const ensureGameplaySectors = (
					this.renderer.game as {
						ensureGameplaySectors?: (
							sectorKeys: Iterable<string>,
							options?: { includeHydrology?: boolean; populateInitialGoods?: boolean }
						) => Promise<boolean>
					}
				).ensureGameplaySectors
				if (ensureGameplaySectors) {
					for (const key of sectorsNeedingTerrain)
						requestInfo.get(key)!.requestMode = 'gameplay-sector'
					const generated = await ensureGameplaySectors.call(this.renderer.game, sectorsNeedingTerrain, {
						includeHydrology: includesDetailedHydrology(this.currentLodMode),
						populateInitialGoods: false,
					})
					for (const key of sectorsNeedingTerrain) requestInfo.get(key)!.generated = generated
				} else {
					for (const next of batch) {
						requestInfo.get(next.key)!.generated = await this.renderer.game.requestGameplayFrontier(
							this.sectorCenter(next.sectorQ, next.sectorR),
							GAMEPLAY_STREAM_RADIUS,
							{ maxBatchSize: GAMEPLAY_STREAM_BATCH_SIZE }
						)
					}
				}
			}
			if (sectorsNeedingBake.length > 0) {
				const ensureTerrainSectors = (
					this.renderer.game as {
						ensureTerrainSectors?: (
							sectorKeys: Iterable<string>,
							options?: { includeHydrology?: boolean }
						) => Promise<void>
					}
				).ensureTerrainSectors
				const ensureTerrainSamples = (
					this.renderer.game as {
						ensureTerrainSamples?: (coords: Iterable<AxialCoord>) => Promise<void>
					}
				).ensureTerrainSamples
				if (ensureTerrainSectors) {
					await ensureTerrainSectors.call(this.renderer.game, sectorsNeedingBake, {
						includeHydrology: includesDetailedHydrology(this.currentLodMode),
					})
				} else if (ensureTerrainSamples) {
					const missing = new Map<string, AxialCoord>()
					for (const key of sectorsNeedingBake) {
						for (const coord of coordsForSectorBakeDomain(key, SECTOR_STEP)) {
							if (this.renderer.game.hasRenderableTerrainAt(coord)) continue
							missing.set(axial.key(coord), coord)
						}
					}
					await ensureTerrainSamples.call(this.renderer.game, missing.values())
				}
			}

			for (const next of batch) {
				const bakeCoords = coordsForSectorBakeDomain(next.key, SECTOR_STEP)
				const interiorCoords = this.coordsForSectorKey(next.key)
				const info = requestInfo.get(next.key)!
				if (info.requestMode === 'gameplay-sector') {
					info.generated =
						interiorCoords.every((coord) => this.hasGameplayContentAt(coord)) &&
						bakeCoords.every((coord) => this.renderer.game.hasRenderableTerrainAt(coord))
				} else if (info.missingBakeTiles === 0) {
					info.generated = await this.renderer.game.requestGameplayFrontier(
						this.sectorCenter(next.sectorQ, next.sectorR),
						GAMEPLAY_STREAM_RADIUS,
						{ maxBatchSize: GAMEPLAY_STREAM_BATCH_SIZE }
					)
				}
				this.recordSectorDiagnostics(
					next.key,
					this.diagnostics.refresh.lodMode,
					countVisibleCoords(interiorCoords, this.visibleTileKeys),
					countMaterializedCoords(interiorCoords, this.visibleTileKeys, this.renderer),
					countMissingCoords(
						bakeCoords,
						new Set(bakeCoords.map((coord) => axial.key(coord))),
						this.renderer
					),
					0,
					0,
					0,
					pendingSectorCountAtStart,
					0,
					0,
					nowMs() - batchStartedAt
				)
			}
		} catch (error) {
			console.error('[TerrainVisual] Failed to materialize gameplay tiles', error)
		} finally {
			let shouldInvalidate = false
			for (const next of batch) {
				const info = requestInfo.get(next.key)!
				this.queueDebug.recentRequests.unshift({
					sectorKey: next.key,
					mode: info.requestMode,
					missingBakeTiles: info.missingBakeTiles,
					generated: info.generated,
					ms: nowMs() - batchStartedAt,
				})
				this.pendingSectors.delete(next.key)
				shouldInvalidate ||= info.generated
			}
			this.queueDebug.recentRequests = this.queueDebug.recentRequests.slice(0, 30)
			if (shouldInvalidate && this.isBound) this.scheduleInvalidate()
		}
	}

	private sectorCenter(sectorQ: number, sectorR: number): AxialCoord {
		return {
			q: sectorQ * SECTOR_STEP + Math.floor(SECTOR_STEP / 2),
			r: sectorR * SECTOR_STEP + Math.floor(SECTOR_STEP / 2),
		}
	}

	private recordSectorDiagnostics(
		sectorKey: string,
		lodMode: TerrainLodMode,
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
			lodMode,
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
		if (lodMode !== 'detail') this.diagnostics.totals.skippedResourceSectorCount++
		if (usesMacroOverview(lodMode)) {
			this.diagnostics.totals.materialSectorBakeCount += groundBatchCount > 0 ? 1 : 0
		}
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

// Cache for sector interior coords to avoid repeated computation
const sectorInteriorCoordsCache = new Map<string, AxialCoord[]>()
const MAX_CACHE_SIZE = 100

function getCachedSectorInteriorCoords(sectorKey: string, sectorStep: number): AxialCoord[] {
	const cached = sectorInteriorCoordsCache.get(sectorKey)
	if (cached) return cached
	
	const coords = coordsForSectorInterior(sectorKey, sectorStep)
	
	// Simple LRU cache eviction
	if (sectorInteriorCoordsCache.size >= MAX_CACHE_SIZE) {
		const firstKey = sectorInteriorCoordsCache.keys().next().value
		if (firstKey !== undefined) {
			sectorInteriorCoordsCache.delete(firstKey)
		}
	}
	
	sectorInteriorCoordsCache.set(sectorKey, coords)
	return coords
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
