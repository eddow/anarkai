import { root } from 'mutts'
import { Application, Container, type ContainerChild, RenderLayer, type Texture } from 'pixi.js'
import type { Game } from 'ssh/game/game'
import type { GameRenderer } from 'ssh/types/engine'
import type { AxialCoord } from 'ssh/utils'
import { cartesian, tileSize } from 'ssh/utils'
import { assetManager } from './asset-manager'
import {
	type TerrainBakeDebugSnapshot,
	type TerrainQueueDebugSnapshot,
	type TerrainStreamingDiagnostics,
	TerrainVisual,
} from './continuous-terrain'
import { setPixiName } from './debug-names'
import { registerPixiApp, unregisterPixiApp } from './hmr.js'
import { InteractionManager } from './interaction/interaction-manager.js'
import { DragPreviewOverlay } from './renderers/drag-preview-overlay'
import { FreightLineOverlay } from './renderers/freight-line-overlay'
import type { VisualFactoryDiagnostics } from './visual-factory'
import { VisualFactory } from './visual-factory'

export class PixiGameRenderer implements GameRenderer {
	public readonly viewId = 'primary'
	public app?: Application
	public stage?: Container
	private interactionManager?: InteractionManager
	private visualFactory?: VisualFactory
	private dragPreviewOverlay?: DragPreviewOverlay
	private freightLineOverlay?: FreightLineOverlay
	private terrainVisual?: TerrainVisual
	private container: HTMLElement
	private canvas: HTMLCanvasElement | null = null
	private resizeObserver?: ResizeObserver
	private isDestroyed = false

	constructor(
		public readonly game: Game,
		into: HTMLElement
	) {
		this.game.renderer = this
		this.container = into
		root`pixi-renderer:init`(() => {
			this.initialize(into).catch((e) => {
				console.error('[PixiGameRenderer] initialize failed:', e)
			})
		})
	}

	public async initialize(_element: unknown) {
		if (this.isDestroyed) return

		this.app = new Application()
		// @ts-expect-error pixi-debug
		globalThis.__PIXI_APP__ = this.app
		await this.app.init({
			width: 800,
			height: 600,
			backgroundAlpha: 0,
			antialias: true,
			autoDensity: true,
			// resizeTo: this.container // Managed manually
		})

		if (this.isDestroyed) {
			this.app.destroy()
			return
		}

		this.stage = this.app.stage
		this.canvas = this.app.canvas
		this.container.appendChild(this.canvas)

		// Initial Resize
		if (this.container.clientWidth && this.container.clientHeight) {
			this.resize(this.container.clientWidth, this.container.clientHeight)
		}
		if (typeof ResizeObserver !== 'undefined') {
			this.resizeObserver = new ResizeObserver((entries) => {
				const entry = entries[0]
				const width = Math.floor(entry?.contentRect.width ?? this.container.clientWidth)
				const height = Math.floor(entry?.contentRect.height ?? this.container.clientHeight)
				if (width > 0 && height > 0) this.resize(width, height)
			})
			this.resizeObserver.observe(this.container)
		}

		// Load Assets
		// Load Assets
		await assetManager.load()

		// Setup Layers (MUST be before InteractionManager so world exists)
		this.setupLayers()

		// Setup Interaction
		this.interactionManager = new InteractionManager(this.app, this.game)
		this.interactionManager.setup()

		// Setup Visuals
		this.visualFactory = new VisualFactory(this)
		this.visualFactory.bind()

		this.terrainVisual = new TerrainVisual(this)
		this.terrainVisual.bind()
		// @ts-expect-error debug
		globalThis.__ANARKAI_TERRAIN_DIAGNOSTICS__ = () => this.getTerrainDiagnostics()
		// @ts-expect-error debug
		globalThis.__ANARKAI_TERRAIN_BAKE_DEBUG__ = () => this.getTerrainBakeDebug()
		// @ts-expect-error debug
		globalThis.__ANARKAI_TERRAIN_QUEUE_DEBUG__ = () => this.getTerrainQueueDebug()
		// @ts-expect-error debug
		globalThis.__ANARKAI_VISUAL_DIAGNOSTICS__ = () => this.getVisualDiagnostics()

		// Setup Drag Preview Overlay
		this.dragPreviewOverlay = new DragPreviewOverlay(this)
		this.dragPreviewOverlay.bind()

		this.freightLineOverlay = new FreightLineOverlay(this)
		this.freightLineOverlay.bind()

		// Register for HMR
		registerPixiApp(this.app)

		// Signal that renderer is ready and textures can be requested
		if ((this.game as any).rendererReadyResolver) {
			;(this.game as any).rendererReadyResolver()
		}
	}

	public layers!: {
		ground: RenderLayer
		roads: RenderLayer
		alveoli: RenderLayer
		resources: RenderLayer
		storedGoods: RenderLayer // e.g. on borders
		looseGoods: RenderLayer
		vehicles: RenderLayer
		characters: RenderLayer
		ui: Container // in-game ui overlays
	}

	// Map Logic Object UID -> Visual Object
	public visuals = new Map<string, any>()
	public missingTextures: string[] = []

	public world!: Container
	public worldScene!: Container

	get viewState() {
		return {
			zoom: this.world?.scale.x ?? 1,
			camera: {
				x: this.world?.position.x ?? 0,
				y: this.world?.position.y ?? 0,
			},
		}
	}

	private setupLayers() {
		if (!this.stage) return

		// World container holds all game content and acts as the camera
		this.stage.label = 'renderer.stage'
		this.world = setPixiName(new Container(), 'renderer.world')
		this.worldScene = setPixiName(new Container(), 'renderer.worldScene')
		this.stage.addChild(this.world)

		this.layers = {
			ground: setPixiName(new RenderLayer(), 'layer.ground'), // terrain
			roads: setPixiName(new RenderLayer(), 'layer.roads'),
			alveoli: setPixiName(new RenderLayer(), 'layer.alveoli'), // structures
			resources: setPixiName(new RenderLayer(), 'layer.resources'), // resources
			storedGoods: setPixiName(new RenderLayer(), 'layer.storedGoods'),
			looseGoods: setPixiName(new RenderLayer(), 'layer.looseGoods'), // loose goods
			vehicles: setPixiName(new RenderLayer(), 'layer.vehicles'),
			characters: setPixiName(new RenderLayer(), 'layer.characters'),
			ui: setPixiName(new Container(), 'layer.ui'), // UI remains in world? Or screen?
			// Usually UI is screen space. Let's keep UI separate or check usage.
			// GameWidget.vue overlay is DOM based. In-game UI usually stays on screen.
			// For now, let's put UI on stage (screen space) and others in world.
		}

		this.layers.ground.sortableChildren = true
		this.layers.roads.sortableChildren = true
		this.layers.alveoli.sortableChildren = true
		this.layers.resources.sortableChildren = true
		this.layers.storedGoods.sortableChildren = true
		this.layers.looseGoods.sortableChildren = true
		this.layers.vehicles.sortableChildren = true
		this.layers.characters.sortableChildren = true

		this.world.sortableChildren = true
		this.world.addChild(
			this.worldScene,
			this.layers.ground, // terrain
			this.layers.roads,
			this.layers.alveoli, // structures
			this.layers.resources,
			this.layers.storedGoods,
			this.layers.looseGoods,
			this.layers.vehicles,
			this.layers.characters
		)

		// Explicit Z-Index to ensure order
		// - tile background (terrain)
		// - buildings (structures)
		// - resources
		// - stored goods
		// - loose goods
		// - vehicles (always under standalone characters)
		// - characters

		this.layers.ground.zIndex = 0 // terrain
		this.layers.roads.zIndex = 5 // roads over terrain, under structures/resources
		this.layers.alveoli.zIndex = 10 // buildings
		this.layers.resources.zIndex = 20 // resources
		this.layers.storedGoods.zIndex = 30 // stored goods
		this.layers.looseGoods.zIndex = 40 // loose goods
		this.layers.vehicles.zIndex = 45 // vehicles
		this.layers.characters.zIndex = 50 // characters

		// Add UI directly to stage so it doesn't zoom/pan
		this.stage.addChild(this.layers.ui)
	}

	public attachToLayer(layer: RenderLayer, child: ContainerChild) {
		layer.attach(child)
		if (layer.sortableChildren) {
			layer.sortRenderLayerChildren()
		}
	}

	public detachFromLayer(layer: RenderLayer, child: ContainerChild) {
		layer.detach(child)
		if (layer.sortableChildren) {
			layer.sortRenderLayerChildren()
		}
	}

	public resize(width: number, height: number) {
		if (!this.app?.renderer) return
		if (this.app.screen.width === width && this.app.screen.height === height) return
		this.app.renderer.resize(width, height)
		if (this.app.stage) this.app.stage.hitArea = this.app.screen
		this.interactionManager?.publishActiveViewPov()
		this.terrainVisual?.invalidate()
	}

	public invalidateTerrain(coord?: AxialCoord) {
		if (coord) this.terrainVisual?.invalidateAt(coord)
		else this.terrainVisual?.invalidate()
	}

	public invalidateTerrainHard(coord?: AxialCoord) {
		if (coord) this.terrainVisual?.invalidateAt(coord, true)
		else this.terrainVisual?.invalidate(true)
	}

	public getTerrainDiagnostics(): TerrainStreamingDiagnostics | undefined {
		return this.terrainVisual?.getDiagnostics()
	}

	public getTerrainBakeDebug(): TerrainBakeDebugSnapshot | undefined {
		return this.terrainVisual?.getBakeDebug()
	}

	public getTerrainQueueDebug(): TerrainQueueDebugSnapshot | undefined {
		return this.terrainVisual?.getQueueDebug()
	}

	public getVisualDiagnostics(): VisualFactoryDiagnostics | undefined {
		return this.visualFactory?.getDiagnostics()
	}

	// Resource management
	public getTexture(spec: string): Texture {
		return assetManager.getTexture(spec)
	}

	public destroy() {
		this.isDestroyed = true
		this.resizeObserver?.disconnect()
		this.resizeObserver = undefined

		this.interactionManager?.teardown()
		this.dragPreviewOverlay?.dispose()
		this.freightLineOverlay?.dispose()
		this.visualFactory?.destroy()
		this.terrainVisual?.dispose()

		if (this.app) {
			unregisterPixiApp(this.app)
			this.app.destroy({
				removeView: true,
				releaseGlobalResources: false, // Don't release global assets to allow reload
			})
		} else if (this.canvas?.parentNode) {
			this.canvas.parentNode.removeChild(this.canvas)
		}

		this.canvas = null
		this.app = undefined
		this.stage = undefined
		this.layers = {} as any
		this.visuals.clear()
		this.worldScene = undefined as any
		this.terrainVisual = undefined
		// @ts-expect-error debug
		delete globalThis.__ANARKAI_TERRAIN_DIAGNOSTICS__
		// @ts-expect-error debug
		delete globalThis.__ANARKAI_TERRAIN_BAKE_DEBUG__
		// @ts-expect-error debug
		delete globalThis.__ANARKAI_TERRAIN_QUEUE_DEBUG__
		// @ts-expect-error debug
		delete globalThis.__ANARKAI_VISUAL_DIAGNOSTICS__
	}

	/**
	 * Fit the camera view to show all player-owned content.
	 * If there is no player content (new game), keeps the default center at (0,0).
	 */
	public fitViewToContent() {
		if (!this.world || !this.app) return

		const bounds = this.game.getPlayerContentBounds()
		if (!bounds) return // new game: keep defaults

		// Convert hex bounds to pixel bounds
		// Sample the 4 corners of the hex bounding box
		const corners = [
			{ q: bounds.minQ, r: bounds.minR },
			{ q: bounds.minQ, r: bounds.maxR },
			{ q: bounds.maxQ, r: bounds.minR },
			{ q: bounds.maxQ, r: bounds.maxR },
			// Also add the center
			{ q: (bounds.minQ + bounds.maxQ) / 2, r: (bounds.minR + bounds.maxR) / 2 },
		]

		let minX = Infinity
		let maxX = -Infinity
		let minY = Infinity
		let maxY = -Infinity

		for (const corner of corners) {
			const pixel = cartesian(corner, tileSize)
			minX = Math.min(minX, pixel.x)
			maxX = Math.max(maxX, pixel.x)
			minY = Math.min(minY, pixel.y)
			maxY = Math.max(maxY, pixel.y)
		}

		const pixelWidth = maxX - minX
		const pixelHeight = maxY - minY

		// 10% padding
		const pad = 1.1

		// Calculate zoom to fit with padding
		const zoomX = (this.app.screen.width * pad) / pixelWidth
		const zoomY = (this.app.screen.height * pad) / pixelHeight
		const zoom = Math.min(zoomX, zoomY)

		// Clamp zoom to InteractionManager limits
		const clampedZoom = Math.max(0.03, Math.min(4.0, zoom))

		// Calculate center in pixel space
		const centerX = (minX + maxX) / 2
		const centerY = (minY + maxY) / 2

		// Apply zoom and position to center the content
		this.world.scale.set(clampedZoom)
		this.world.position.set(
			this.app.screen.width / 2 - centerX * clampedZoom,
			this.app.screen.height / 2 - centerY * clampedZoom
		)
		this.interactionManager?.publishActiveViewPov()
	}

	public async reload() {
		this.destroy()
		this.isDestroyed = false
		await this.initialize(this.container)
	}
}
