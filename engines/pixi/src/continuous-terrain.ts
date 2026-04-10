import { effect, type ScopedCallback } from 'mutts'
import { Container, Graphics, Particle, ParticleContainer, Point, Sprite, Texture } from 'pixi.js'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { mrg } from 'ssh/interactive-state'
import type { RenderableTerrainTile } from 'ssh/game/game'
import { axial, axialRectangle, cartesian, fromCartesian, type AxialCoord } from 'ssh/utils'
import { tileSize } from 'ssh/utils/varied'
import { setPixiName } from './debug-names'
import type { PixiGameRenderer } from './renderer'
import { createTerrainHexSprite } from './renderers/terrain-hex-sprite'
import {
	buildStaticResourceSpriteSpecs,
	resolveUsableTexture,
} from './renderers/static-resource-sprites'
import { terrainTextureSpec, terrainTintForTile } from './terrain-visual-helpers'

const SECTOR_RADIUS = 8
// Hex regions of radius R tile edge-to-edge when their centers are spaced by 2R + 1.
const SECTOR_STEP = SECTOR_RADIUS * 2 + 1
// Keep nearby sectors in memory to reduce render churn while panning.
const RETAINED_SECTOR_MARGIN = 2
// Visible sectors are stored as axial rectangles, whose furthest corner is farther
// than SECTOR_RADIUS from the sector center on a hex metric.
const GAMEPLAY_STREAM_RADIUS = SECTOR_STEP - 1
const GAMEPLAY_STREAM_BATCH_SIZE = 96
const TERRAIN_DIAGNOSTIC_HISTORY_LIMIT = 12
const SLOW_SECTOR_LOG_THRESHOLD_MS = 16
const MAX_PENDING_SECTORS = 1
const MAX_SECTOR_STARTS_PER_REFRESH = 1
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
	renderedVisibleKeys: Set<string>
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
	private readonly container = setPixiName(new Container(), 'terrain.continuous')
	private readonly sectorsContainer = setPixiName(new Container(), 'terrain.continuous:sectors')
	private readonly hoverOverlay = setPixiName(new Graphics(), 'terrain.continuous:hover')
	private lastSignature = ''
	private readonly sectors = new Map<string, SectorVisualState>()
	private readonly sectorCoords = new Map<string, AxialCoord[]>()
	private readonly pendingSectors = new Set<string>()
	private visibleTileKeys = new Set<string>()
	private visibleSectorKeys = new Set<string>()
	private visibleSectorQueue: QueuedSector[] = []
	private refreshScheduled = false
	private refreshScheduledClearCache = false
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
		this.refresh()
		this.renderer.app?.ticker.addOnce(() => this.invalidate())
	}

	public dispose() {
		this.renderer.app?.ticker.remove(this.refresh)
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

	public invalidate(clearCache = false) {
		if (clearCache) {
			this.clearSectors()
		}
		this.lastSignature = ''
		this.refresh()
	}

	private scheduleInvalidate(clearCache = false) {
		this.refreshScheduledClearCache = this.refreshScheduledClearCache || clearCache
		if (this.refreshScheduled) return
		this.refreshScheduled = true
		queueMicrotask(() => {
			this.refreshScheduled = false
			const shouldClearCache = this.refreshScheduledClearCache
			this.refreshScheduledClearCache = false
			this.invalidate(shouldClearCache)
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
	}

	private clearSectors() {
		for (const sector of this.sectors.values()) this.destroySectorVisualState(sector)
		this.sectors.clear()
		this.sectorCoords.clear()
		this.visibleSectorKeys.clear()
		this.visibleSectorQueue = []
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
			renderedVisibleKeys: new Set<string>(),
		}
	}

	private syncLoadedSectorVisuals() {
		for (const [sectorKey, sectorState] of this.sectors) {
			const renderCoords = this.coordsForSectorKey(sectorKey)
			this.renderSectorVisuals(sectorKey, renderCoords, sectorState)
		}
	}

	private renderSectorVisuals(
		sectorKey: string,
		renderCoords: AxialCoord[],
		sectorState: SectorVisualState
	): { renderedTileCount: number; missingTileCount: number } {
		const sectorStartedAt = nowMs()
		const visibleCoords = renderCoords.filter((coord) => this.visibleTileKeys.has(axial.key(coord)))
		const visibleKeys = new Set(visibleCoords.map((coord) => axial.key(coord)))
		let missingTileCount = 0
		for (const coord of visibleCoords) {
			if (!this.renderer.game.hasRenderableTerrainAt(coord)) missingTileCount++
		}
		if (setsEqual(visibleKeys, sectorState.renderedVisibleKeys) && missingTileCount === 0) {
			return {
				renderedTileCount: sectorState.renderedVisibleKeys.size,
				missingTileCount,
			}
		}

		this.clearSectorVisuals(sectorState)
		sectorState.renderedVisibleKeys = visibleKeys
		const groundStartedAt = nowMs()
		const groundBatchCount = this.rebuildSectorGround(sectorKey, visibleCoords, sectorState)
		const groundBatchBuildMs = nowMs() - groundStartedAt
		const resourceStartedAt = nowMs()
		const { resourceBatchCount, staticResourceSpriteCount } = this.rebuildSectorResources(
			sectorKey,
			visibleCoords,
			sectorState
		)
		const resourceBatchBuildMs = nowMs() - resourceStartedAt
		const renderedTileCount = countMaterializedCoords(
			visibleCoords,
			visibleKeys,
			this.renderer
		)

		sectorState.container.visible = renderedTileCount > 0

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
		for (const child of sectorState.groundLayer.removeChildren()) {
			child.destroy({ children: true })
		}
		for (const child of sectorState.resourceLayer.removeChildren()) {
			child.destroy({ children: true })
		}
	}

	private rebuildSectorGround(
		sectorKey: string,
		visibleCoords: AxialCoord[],
		sectorState: SectorVisualState
	): number {
		for (const child of sectorState.groundLayer.removeChildren()) {
			child.destroy({ children: true })
		}

		const grouped = new Map<string, Array<{ coord: AxialCoord; terrainTile: RenderableTerrainTile }>>()
		for (const coord of visibleCoords) {
			const terrainTile = this.renderer.game.getRenderableTerrainAt(coord)
			if (!terrainTile) continue
			const textureSpec = terrainTextureSpec(terrainTile.terrain, 'grass')
			if (!grouped.has(textureSpec)) grouped.set(textureSpec, [])
			grouped.get(textureSpec)!.push({ coord, terrainTile })
		}

		let groundBatchCount = 0
		for (const [textureSpec, tiles] of grouped) {
			const batch = this.buildGroundBatchSprite(sectorKey, textureSpec, tiles)
			if (!batch) continue
			sectorState.groundLayer.addChild(batch)
			groundBatchCount++
		}
		return groundBatchCount
	}

	private buildGroundBatchSprite(
		sectorKey: string,
		textureSpec: string,
		tiles: Array<{ coord: AxialCoord; terrainTile: RenderableTerrainTile }>
	): Sprite | undefined {
		const appRenderer = this.renderer.app?.renderer
		const texture = resolveUsableTexture(this.renderer, textureSpec)
		if (!appRenderer || !texture || tiles.length === 0) return undefined

		const bounds = computeWorldBounds(tiles.map(({ coord }) => coord))
		const temp = setPixiName(new Container(), `terrain.continuous:${sectorKey}:${textureSpec}:source`)
		temp.eventMode = 'none'

		for (const { coord } of tiles) {
			const world = cartesian(coord, tileSize)
			const local = { x: world.x - bounds.minX, y: world.y - bounds.minY }
			temp.addChild(
				createTerrainHexSprite({
					scope: `terrain.continuous.tile:${coord.q},${coord.r}`,
					texture,
					position: local,
					tileOrigin: world,
					tint: terrainTintForTile(),
				}).container
			)
		}

		const generatedTexture = appRenderer.textureGenerator.generateTexture({
			target: temp,
			resolution: 1,
		})
		temp.destroy({ children: true })

		const sprite = setPixiName(
			new Sprite(generatedTexture),
			`terrain.continuous:${sectorKey}:${textureSpec}:batch`
		)
		sprite.eventMode = 'none'
		sprite.position.set(bounds.minX, bounds.minY)
		return sprite
	}

	private rebuildSectorResources(
		sectorKey: string,
		visibleCoords: AxialCoord[],
		sectorState: SectorVisualState
	): { resourceBatchCount: number; staticResourceSpriteCount: number } {
		for (const child of sectorState.resourceLayer.removeChildren()) {
			child.destroy({ children: true })
		}

		const grouped = new Map<string, ResourceSpriteBuild[]>()
		for (const coord of visibleCoords) {
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
						new Particle(build.texture, {
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
			particleContainer.boundsArea = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
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
			sectorState.resourceLayer.boundsArea = {
				x: sectorMinX,
				y: sectorMinY,
				width: sectorMaxX - sectorMinX,
				height: sectorMaxY - sectorMinY,
			}
		} else {
			const sectorBounds = computeWorldBounds(visibleCoords)
			sectorState.resourceLayer.boundsArea = {
				x: sectorBounds.minX,
				y: sectorBounds.minY,
				width: sectorBounds.maxX - sectorBounds.minX,
				height: sectorBounds.maxY - sectorBounds.minY,
			}
		}

		return { resourceBatchCount, staticResourceSpriteCount }
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
			if (this.pendingSectors.has(key)) continue
			const renderCoords = this.coordsForSectorKey(key)
			const hasMissingVisibleTile = renderCoords.some(
				(coord) => this.visibleTileKeys.has(axial.key(coord)) && !this.renderer.game.hasRenderableTerrainAt(coord)
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
		try {
			generated = await this.renderer.game.requestGameplayFrontier(
				this.sectorCenter(next.sectorQ, next.sectorR),
				GAMEPLAY_STREAM_RADIUS,
				{ maxBatchSize: GAMEPLAY_STREAM_BATCH_SIZE }
			)
			this.recordSectorDiagnostics(
				next.key,
				countVisibleCoords(this.coordsForSectorKey(next.key), this.visibleTileKeys),
				countMaterializedCoords(this.coordsForSectorKey(next.key), this.visibleTileKeys, this.renderer),
				countMissingCoords(this.coordsForSectorKey(next.key), this.visibleTileKeys, this.renderer),
				pendingSectorCountAtStart,
				0,
				nowMs() - sectorStartedAt
			)
		} catch (error) {
			console.error('[TerrainVisual] Failed to materialize gameplay tiles', error)
		} finally {
			this.pendingSectors.delete(next.key)
			if (generated) this.scheduleInvalidate()
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
