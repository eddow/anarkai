import { effect, type ScopedCallback } from 'mutts'
import { Container, Graphics, Point } from 'pixi.js'
import { mrg } from 'ssh/interactive-state'
import type { TerrainType } from 'ssh/types'
import { tileSize } from 'ssh/utils/varied'
import {
	type AxialCoord,
	axial,
	axialRectangle,
	type BiomeHint,
	cartesian,
	createSnapshot,
	fromCartesian,
	type HydratedRegionMetrics,
	type TerrainSnapshot,
	type TileField,
	type TileOverride,
	canUseWebGpuFields,
	edgeKey,
	generateHydratedRegionAsyncWithMetrics,
	mergeSnapshotRegion,
	pruneSnapshot,
	warmGpuFieldRuntime,
} from '../../terrain/src/index'
import { setPixiName } from './debug-names'
import type { PixiGameRenderer } from './renderer'
import { createTerrainHexSprite } from './renderers/terrain-hex-sprite'
import {
	terrainTextureSpec,
	terrainTintForTile,
} from './terrain-visual-helpers'

const RIVER_GLOW_COLOR = 0x285e9d
const RIVER_CORE_COLOR = 0x7fc4f4
const RIVER_FLUX_THRESHOLD = 1.25

const SECTOR_RADIUS = 8
const HYDROLOGY_PADDING = 4
// Hex regions of radius R tile edge-to-edge when their centers are spaced by 2R + 1.
const SECTOR_STEP = SECTOR_RADIUS * 2 + 1
// Keep nearby sectors in memory to reduce regeneration churn while panning.
const RETAINED_SECTOR_MARGIN = 2
const GAMEPLAY_STREAM_RADIUS = 8
const GAMEPLAY_STREAM_BATCH_SIZE = 96
const TERRAIN_DIAGNOSTIC_HISTORY_LIMIT = 12
const SLOW_SECTOR_LOG_THRESHOLD_MS = 16
const MAX_PENDING_SECTORS = 1
const MAX_SECTOR_STARTS_PER_REFRESH = 1
const HEX_HALF_WIDTH = (Math.sqrt(3) / 2) * tileSize
const HEX_HALF_HEIGHT = tileSize

export interface TerrainSectorDiagnostics {
	sectorKey: string
	requestedTileCount: number
	paddedTileCount: number
	visibleTileCount: number
	renderedTileCount: number
	renderedEdgeCount: number
	paddingAmplification: number
	renderAmplification: number | null
	fieldBackendRequested: HydratedRegionMetrics['fieldBackendRequested']
	fieldBackendResolved: HydratedRegionMetrics['fieldBackendResolved']
	gpuRuntimeReadyAtStart: boolean
	pendingSectorCountAtStart: number
	snapshotTileCountAfterMerge: number
	snapshotEdgeCountAfterMerge: number
	timings: HydratedRegionMetrics['timings'] & {
		visualCreationMs: number
		mergeMs: number
		schedulingOverheadMs: number
		totalSectorMs: number
	}
}

export interface TerrainRefreshDiagnostics {
	center: AxialCoord
	radius: number
	visibleTileCount: number
	visibleSectorCount: number
	loadedVisibleSectorCount: number
	missingVisibleSectorCount: number
	queuedVisibleSectorCount: number
	pendingSectorCount: number
	retainedSectorCount: number
	loadedSectorCount: number
	snapshotTileCount: number
	snapshotEdgeCount: number
	prunedTileCount: number
	refreshMs: number
}

export interface TerrainStreamingDiagnostics {
	refresh: TerrainRefreshDiagnostics
	recentSectors: TerrainSectorDiagnostics[]
	totals: {
		sectorsRendered: number
		tileSpritesCreated: number
		riverSegmentsDrawn: number
		maxRenderAmplification: number
		maxSectorTotalMs: number
	}
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
	tileLayer: Container
	overlayLayer: Graphics
	renderedVisibleKeys: Set<string>
}

function impliedTerrainForCoord(renderer: PixiGameRenderer, coord: AxialCoord): TerrainType | undefined {
	const content = renderer.game.hex.getTileContent(coord) as
		| { terrain?: unknown }
		| undefined
	if (!content) return undefined
	// Backward-compatible fallback: non-land tile contents (alveoli/build sites)
	// were historically rendered over concrete even when not explicitly patched.
	if (typeof content.terrain !== 'string') {
		return 'concrete'
	}
	return undefined
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

function terrainToBiome(terrain: TerrainType | undefined): BiomeHint | undefined {
	switch (terrain) {
		case 'water':
			return 'lake'
		case 'sand':
			return 'sand'
		case 'grass':
			return 'grass'
		case 'forest':
			return 'forest'
		case 'rocky':
			return 'rocky'
		case 'snow':
			return 'snow'
		default:
			return undefined
	}
}

function overridesSignature(
	overrides: ReadonlyArray<PixiGameRenderer['game']['terrainOverrides'][number]>
): string {
	return overrides
		.map((o) => {
			const [q, r] = o.coord
			return `${q},${r}:${o.height ?? ''}:${o.temperature ?? ''}:${o.humidity ?? ''}:${o.sediment ?? ''}:${o.waterTable ?? ''}:${o.terrain ?? ''}`
		})
		.sort()
		.join('|')
}

function toTileOverrides(
	overrides: ReadonlyArray<PixiGameRenderer['game']['terrainOverrides'][number]>
): TileOverride[] {
	return overrides.map((o) => {
		const tile: TileOverride['tile'] = {}
		if (o.height !== undefined) tile.height = o.height
		if (o.temperature !== undefined) tile.temperature = o.temperature
		if (o.humidity !== undefined) tile.humidity = o.humidity
		if (o.sediment !== undefined) tile.sediment = o.sediment
		if (o.waterTable !== undefined) tile.waterTable = o.waterTable

		return {
			coord: { q: o.coord[0], r: o.coord[1] },
			tile: Object.keys(tile).length > 0 ? tile : undefined,
			biome: terrainToBiome(o.terrain),
		}
	})
}

function buildTerrainOverridesMap(
	overrides: ReadonlyArray<PixiGameRenderer['game']['terrainOverrides'][number]>
): Map<string, TerrainType | undefined> {
	return new Map(
		overrides.map((override) => [`${override.coord[0]},${override.coord[1]}`, override.terrain])
	)
}

export class TerrainVisual {
	private readonly container = setPixiName(new Container(), 'terrain.continuous')
	private readonly sectorsContainer = setPixiName(new Container(), 'terrain.continuous:sectors')
	private readonly hoverOverlay = setPixiName(new Graphics(), 'terrain.continuous:hover')
	private readonly snapshot: TerrainSnapshot
	private lastSignature = ''
	private lastOverrideSignature = ''
	private readonly sectors = new Map<string, SectorVisualState>()
	private readonly sectorCoords = new Map<string, AxialCoord[]>()
	private readonly pendingSectors = new Set<string>()
	private generationEpoch = 0
	private lastCenter: AxialCoord = { q: 0, r: 0 }
	private visibleTileKeys = new Set<string>()
	private visibleSectorKeys = new Set<string>()
	private visibleSectorQueue: QueuedSector[] = []
	private diagnostics: TerrainStreamingDiagnostics = {
		refresh: {
			center: { q: 0, r: 0 },
			radius: 0,
			visibleTileCount: 0,
			visibleSectorCount: 0,
			loadedVisibleSectorCount: 0,
			missingVisibleSectorCount: 0,
			queuedVisibleSectorCount: 0,
			pendingSectorCount: 0,
			retainedSectorCount: 0,
			loadedSectorCount: 0,
			snapshotTileCount: 0,
			snapshotEdgeCount: 0,
			prunedTileCount: 0,
			refreshMs: 0,
		},
		recentSectors: [],
		totals: {
			sectorsRendered: 0,
			tileSpritesCreated: 0,
			riverSegmentsDrawn: 0,
			maxRenderAmplification: 0,
			maxSectorTotalMs: 0,
		},
	}
	private hoverCleanup?: ScopedCallback

	constructor(private readonly renderer: PixiGameRenderer) {
		this.snapshot = createSnapshot(this.renderer.game.terrainSeed)
		this.container.eventMode = 'none'
		this.sectorsContainer.eventMode = 'none'
		this.hoverOverlay.eventMode = 'none'
		this.container.addChild(this.sectorsContainer, this.hoverOverlay)
	}

	public bind() {
		this.renderer.worldScene.addChild(this.container)
		this.renderer.attachToLayer(this.renderer.layers.ground, this.container)
		this.renderer.app?.ticker.add(this.refresh)
		this.hoverCleanup = effect`terrain.hover`(() => {
			this.renderHoverOverlay(isHoveredTileObject(mrg.hoveredObject) ? mrg.hoveredObject : undefined)
		})
		if (canUseWebGpuFields()) {
			void warmGpuFieldRuntime()
		}
		this.refresh()
		// A second refresh on the next frame stabilizes startup after renderer/layer
		// initialization and avoids a blank first paint if terrain work is invalidated
		// during the initial materialization burst.
		this.renderer.app?.ticker.addOnce(() => this.invalidate())
	}

	public dispose() {
		this.renderer.app?.ticker.remove(this.refresh)
		this.hoverCleanup?.()
		this.hoverCleanup = undefined
		if (this.renderer.layers?.ground) {
			this.renderer.detachFromLayer(this.renderer.layers.ground, this.container)
		}
		for (const sector of this.sectors.values()) sector.container.destroy({ children: true })
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

	public invalidate(clearCache = false) {
		if (clearCache) {
			this.clearSectors()
		}
		this.lastSignature = ''
		this.refresh()
	}

	private refresh = () => {
		const refreshStartedAt = nowMs()
		const app = this.renderer.app
		const world = this.renderer.world
		if (!app || !world) return

		const screenCenter = new Point(app.screen.width / 2, app.screen.height / 2)
		const localCenter = world.toLocal(screenCenter)
		const center = axial.round(fromCartesian(localCenter, tileSize))
		this.lastCenter = center
		const worldHalfWidth = app.screen.width / (2 * Math.max(world.scale.x, 0.001))
		const worldHalfHeight = app.screen.height / (2 * Math.max(world.scale.y, 0.001))
		const radius = Math.ceil(Math.max(worldHalfWidth, worldHalfHeight) / tileSize) + 6
		const overrideSig = overridesSignature(this.renderer.game.terrainOverrides)
		if (overrideSig !== this.lastOverrideSignature) {
			this.lastOverrideSignature = overrideSig
			this.clearSectors()
		}
		const signature = `${center.q},${center.r}:${radius}:${app.screen.width}x${app.screen.height}:${overrideSig}`
		if (signature === this.lastSignature) return
		this.lastSignature = signature

		const minQ = center.q - radius
		const maxQ = center.q + radius
		const minR = center.r - radius
		const maxR = center.r + radius
		const viewportBounds = this.currentViewportWorldBounds()
		this.visibleTileKeys = collectVisibleTileKeys(center, radius + 2, viewportBounds)
		this.visibleSectorKeys = collectVisibleSectorKeys(this.visibleTileKeys)
		this.visibleSectorQueue = this.buildVisibleSectorQueue(center)
		const loadedVisibleSectorCount = countMatchingKeys(this.visibleSectorKeys, this.sectors)
		const pendingVisibleSectorCount = countMatchingKeys(this.visibleSectorKeys, this.pendingSectors)
		const missingVisibleSectorCount =
			this.visibleSectorKeys.size - loadedVisibleSectorCount - pendingVisibleSectorCount
		this.pumpVisibleSectorQueue()
		if (missingVisibleSectorCount === 0 && this.pendingSectors.size === 0 && this.visibleSectorQueue.length === 0) {
			this.requestGameplayFrontier()
		}

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
			sector.container.destroy({ children: true })
			this.sectors.delete(sectorKey)
			this.sectorCoords.delete(sectorKey)
		}

		this.syncLoadedSectorVisuals()

		const retainedCoords = [...retainedSectorKeys].flatMap((key) => this.coordsForSectorKey(key))
		let prunedTileCount = 0
		if (retainedCoords.length > 0) {
			prunedTileCount = pruneSnapshot(this.snapshot, retainedCoords).removedTiles.length
		}
		const visibleSectorCount = this.visibleSectorKeys.size
		this.diagnostics.refresh = {
			center,
			radius,
			visibleTileCount: this.visibleTileKeys.size,
			visibleSectorCount,
			loadedVisibleSectorCount,
			missingVisibleSectorCount,
			queuedVisibleSectorCount: this.visibleSectorQueue.length,
			pendingSectorCount: this.pendingSectors.size,
			retainedSectorCount: retainedSectorKeys.size,
			loadedSectorCount: this.sectors.size,
			snapshotTileCount: this.snapshot.tiles.size,
			snapshotEdgeCount: this.snapshot.edges.size,
			prunedTileCount,
			refreshMs: nowMs() - refreshStartedAt,
		}
	}

	private clearSectors() {
		this.generationEpoch++
		for (const sector of this.sectors.values()) sector.container.destroy({ children: true })
		this.sectors.clear()
		this.sectorCoords.clear()
		this.pendingSectors.clear()
		this.visibleSectorKeys.clear()
		this.visibleSectorQueue = []
		this.snapshot.tiles.clear()
		this.snapshot.biomes.clear()
		this.snapshot.edges.clear()
	}

	private async renderSector(sectorQ: number, sectorR: number) {
		const sectorKey = `${sectorQ},${sectorR}`
		if (this.pendingSectors.has(sectorKey) || this.sectors.has(sectorKey)) return
		const sectorStartedAt = nowMs()
		const pendingSectorCountAtStart = this.pendingSectors.size
		this.pendingSectors.add(sectorKey)
		const epoch = this.generationEpoch
		try {
			const start = { q: sectorQ * SECTOR_STEP, r: sectorR * SECTOR_STEP }
			const end = { q: start.q + SECTOR_STEP - 1, r: start.r + SECTOR_STEP - 1 }
			const renderCoords = axialRectangle(start, end)
			const { snapshot: hydrated, metrics } = await generateHydratedRegionAsyncWithMetrics(
				this.snapshot.seed,
				renderCoords,
				{
				fieldBackend: 'auto',
				hydrologyPadding: HYDROLOGY_PADDING,
				tileOverrides: toTileOverrides(this.renderer.game.terrainOverrides),
				}
			)
			if (epoch !== this.generationEpoch) return
			const mergeStartedAt = nowMs()
			mergeSnapshotRegion(this.snapshot, hydrated)
			const mergeCompletedAt = nowMs()
			const visualCreationStartedAt = nowMs()
			const sectorState = this.createSectorVisualState(sectorKey)
			const { renderedTileCount, renderedEdgeCount } = this.renderSectorVisuals(
				sectorKey,
				renderCoords,
				sectorState,
				buildTerrainOverridesMap(this.renderer.game.terrainOverrides)
			)
			const visualCreationCompletedAt = nowMs()

			if (epoch !== this.generationEpoch) {
				sectorState.container.destroy({ children: true })
				return
			}
			this.sectors.set(sectorKey, sectorState)
			this.sectorCoords.set(sectorKey, renderCoords)
			this.sectorsContainer.addChild(sectorState.container)
			this.recordSectorDiagnostics(
				sectorKey,
				renderCoords,
				renderedTileCount,
				renderedEdgeCount,
				pendingSectorCountAtStart,
				metrics,
				mergeCompletedAt - mergeStartedAt,
				visualCreationCompletedAt - visualCreationStartedAt,
				nowMs() - sectorStartedAt
			)
		} finally {
			this.pendingSectors.delete(sectorKey)
			this.pumpVisibleSectorQueue()
		}
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

	private createTerrainTileSprite(
		coord: AxialCoord,
		tile: TileField,
		biome: BiomeHint,
		terrain?: TerrainType
	): Container {
		const world = cartesian(coord, tileSize)
		const texture = this.renderer.getTexture(terrainTextureSpec(terrain, biome))
		return createTerrainHexSprite({
			scope: `terrain.continuous.tile:${coord.q},${coord.r}`,
			texture,
			position: world,
			tileOrigin: world,
			tint: terrainTintForTile(biome, tile),
		}).container
	}

	private createSectorVisualState(sectorKey: string): SectorVisualState {
		const container = setPixiName(new Container(), `terrain.continuous:${sectorKey}`)
		container.eventMode = 'none'
		const tileLayer = setPixiName(new Container(), `terrain.continuous:${sectorKey}:tiles`)
		const overlayLayer = setPixiName(new Graphics(), `terrain.continuous:${sectorKey}:overlay`)
		tileLayer.eventMode = 'none'
		overlayLayer.eventMode = 'none'
		container.addChild(tileLayer, overlayLayer)
		return {
			container,
			tileLayer,
			overlayLayer,
			renderedVisibleKeys: new Set<string>(),
		}
	}

	private syncLoadedSectorVisuals() {
		const terrainOverrides = buildTerrainOverridesMap(this.renderer.game.terrainOverrides)
		for (const [sectorKey, sectorState] of this.sectors) {
			const renderCoords = this.coordsForSectorKey(sectorKey)
			this.renderSectorVisuals(sectorKey, renderCoords, sectorState, terrainOverrides)
		}
	}

	private renderSectorVisuals(
		sectorKey: string,
		renderCoords: AxialCoord[],
		sectorState: SectorVisualState,
		terrainOverrides: Map<string, TerrainType | undefined>
	): { renderedTileCount: number; renderedEdgeCount: number } {
		const visibleCoords = renderCoords.filter((coord) => this.visibleTileKeys.has(axial.key(coord)))
		const visibleKeys = new Set(visibleCoords.map((coord) => axial.key(coord)))
		if (setsEqual(visibleKeys, sectorState.renderedVisibleKeys)) {
			return {
				renderedTileCount: sectorState.renderedVisibleKeys.size,
				renderedEdgeCount: 0,
			}
		}

		this.clearSectorVisuals(sectorState)
		sectorState.renderedVisibleKeys = visibleKeys
		let renderedTileCount = 0
		let renderedEdgeCount = 0

		for (const coord of visibleCoords) {
			const key = axial.key(coord)
			const tile = this.snapshot.tiles.get(key)
			if (!tile) continue
			const biome = this.snapshot.biomes.get(key)
			if (!biome) continue
			const overrideTerrain = terrainOverrides.get(key) ?? impliedTerrainForCoord(this.renderer, coord)
			sectorState.tileLayer.addChild(
				this.createTerrainTileSprite(coord, tile, biome, overrideTerrain)
			)
			renderedTileCount++
		}

		for (const coord of visibleCoords) {
			const key = axial.key(coord)
			for (const neighbor of axial.neighbors(coord)) {
				const neighborKey = axial.key(neighbor)
				const edge = this.snapshot.edges.get(edgeKey(key, neighborKey))
				if (!edge || edge.flux <= RIVER_FLUX_THRESHOLD) continue
				if (key >= neighborKey) continue
				if (!visibleKeys.has(neighborKey) && !this.visibleTileKeys.has(neighborKey)) continue

				const from = cartesian(coord, tileSize)
				const to = cartesian(neighbor, tileSize)
				const outerWidth = Math.max(3.5, Math.min(10.5, edge.width * 1.05))
				const innerWidth = Math.max(1.8, Math.min(6.25, edge.width * 0.65))
				sectorState.overlayLayer
					.moveTo(from.x, from.y)
					.lineTo(to.x, to.y)
					.stroke({
						width: outerWidth,
						color: RIVER_GLOW_COLOR,
						alpha: 0.48,
						cap: 'round',
					})
				sectorState.overlayLayer
					.moveTo(from.x, from.y)
					.lineTo(to.x, to.y)
					.stroke({
						width: innerWidth,
						color: RIVER_CORE_COLOR,
						alpha: 1,
						cap: 'round',
					})
				renderedEdgeCount++
			}
		}

		if (renderedTileCount === 0) {
			sectorState.container.visible = false
		} else {
			sectorState.container.visible = true
		}

		return { renderedTileCount, renderedEdgeCount }
	}

	private clearSectorVisuals(sectorState: SectorVisualState) {
		for (const child of sectorState.tileLayer.removeChildren()) {
			child.destroy({ children: true })
		}
		sectorState.overlayLayer.clear()
	}

	private coordsForSectorKey(sectorKey: string): AxialCoord[] {
		const cached = this.sectorCoords.get(sectorKey)
		if (cached) return cached
		const [q, r] = sectorKey.split(',').map(Number)
		const start = { q: q * SECTOR_STEP, r: r * SECTOR_STEP }
		const end = { q: start.q + SECTOR_STEP - 1, r: start.r + SECTOR_STEP - 1 }
		return axialRectangle(start, end)
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
		const queue: QueuedSector[] = []
		for (const key of this.visibleSectorKeys) {
			if (this.sectors.has(key) || this.pendingSectors.has(key)) continue
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
			minX: Math.min(...worldCorners.map((corner) => corner.x)),
			maxX: Math.max(...worldCorners.map((corner) => corner.x)),
			minY: Math.min(...worldCorners.map((corner) => corner.y)),
			maxY: Math.max(...worldCorners.map((corner) => corner.y)),
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
			if (this.sectors.has(next.key) || this.pendingSectors.has(next.key)) continue
			void this.renderSector(next.sectorQ, next.sectorR)
			started++
		}
	}

	private sectorCenter(sectorQ: number, sectorR: number): AxialCoord {
		return {
			q: sectorQ * SECTOR_STEP + Math.floor(SECTOR_STEP / 2),
			r: sectorR * SECTOR_STEP + Math.floor(SECTOR_STEP / 2),
		}
	}

	private requestGameplayFrontier() {
		void this.renderer.game
			.requestGameplayFrontier(this.lastCenter, GAMEPLAY_STREAM_RADIUS, {
				maxBatchSize: GAMEPLAY_STREAM_BATCH_SIZE,
			})
			.then((generated) => {
				if (!generated) return
				this.invalidate()
			})
			.catch((error) => {
				console.error('[TerrainVisual] Failed to materialize gameplay tiles', error)
			})
	}

	private recordSectorDiagnostics(
		sectorKey: string,
		renderCoords: AxialCoord[],
		renderedTileCount: number,
		renderedEdgeCount: number,
		pendingSectorCountAtStart: number,
		metrics: HydratedRegionMetrics,
		mergeMs: number,
		visualCreationMs: number,
		totalSectorMs: number
	) {
		const visibleTileCount = countVisibleCoords(renderCoords, this.visibleTileKeys)
		const renderAmplification =
			visibleTileCount > 0 ? renderedTileCount / visibleTileCount : null
		const schedulingOverheadMs = Math.max(
			0,
			totalSectorMs - metrics.timings.totalMs - visualCreationMs - mergeMs
		)
		const sectorDiagnostics: TerrainSectorDiagnostics = {
			sectorKey,
			requestedTileCount: metrics.requestedTileCount,
			paddedTileCount: metrics.paddedTileCount,
			visibleTileCount,
			renderedTileCount,
			renderedEdgeCount,
			paddingAmplification: metrics.paddingAmplification,
			renderAmplification,
			fieldBackendRequested: metrics.fieldBackendRequested,
			fieldBackendResolved: metrics.fieldBackendResolved,
			gpuRuntimeReadyAtStart: metrics.gpuRuntimeReadyAtStart,
			pendingSectorCountAtStart,
			snapshotTileCountAfterMerge: this.snapshot.tiles.size,
			snapshotEdgeCountAfterMerge: this.snapshot.edges.size,
			timings: {
				...metrics.timings,
				visualCreationMs,
				mergeMs,
				schedulingOverheadMs,
				totalSectorMs,
			},
		}

		this.diagnostics.recentSectors.unshift(sectorDiagnostics)
		this.diagnostics.recentSectors = this.diagnostics.recentSectors.slice(
			0,
			TERRAIN_DIAGNOSTIC_HISTORY_LIMIT
		)
		this.diagnostics.totals.sectorsRendered++
		this.diagnostics.totals.tileSpritesCreated += renderedTileCount
		this.diagnostics.totals.riverSegmentsDrawn += renderedEdgeCount
		this.diagnostics.totals.maxRenderAmplification = Math.max(
			this.diagnostics.totals.maxRenderAmplification,
			renderAmplification ?? 0
		)
		this.diagnostics.totals.maxSectorTotalMs = Math.max(
			this.diagnostics.totals.maxSectorTotalMs,
			totalSectorMs
		)

		if (totalSectorMs >= SLOW_SECTOR_LOG_THRESHOLD_MS) {
			console.debug('[TerrainVisual] Slow sector render', sectorDiagnostics)
		}
	}
}

function countVisibleCoords(coords: Iterable<AxialCoord>, visibleKeys: Set<string>): number {
	let visibleCount = 0
	for (const coord of coords) {
		if (visibleKeys.has(axial.key(coord))) visibleCount++
	}
	return visibleCount
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
		sectorKeys.add(sectorKeyForCoord(coord))
	}
	return sectorKeys
}

function sectorKeyForCoord(coord: AxialCoord): string {
	return `${Math.floor(coord.q / SECTOR_STEP)},${Math.floor(coord.r / SECTOR_STEP)}`
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
