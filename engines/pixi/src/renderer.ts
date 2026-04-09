import { Application, Container, RenderLayer, type Texture, type ContainerChild } from 'pixi.js'
import type { Game } from 'ssh/game/game'
import type { GameRenderer } from 'ssh/types/engine'
import { assetManager } from './asset-manager'
import { TerrainVisual, type TerrainStreamingDiagnostics } from './continuous-terrain'
import { setPixiName } from './debug-names'
import { registerPixiApp, unregisterPixiApp } from './hmr.js'
import { InteractionManager } from './interaction/interaction-manager.js'
import { DragPreviewOverlay } from './renderers/drag-preview-overlay'
import { VisualFactory } from './visual-factory'

export class PixiGameRenderer implements GameRenderer {
	public app?: Application
	public stage?: Container
	private interactionManager?: InteractionManager
	private visualFactory?: VisualFactory
	private dragPreviewOverlay?: DragPreviewOverlay
	private terrainVisual?: TerrainVisual
	private container: HTMLElement
	private canvas: HTMLCanvasElement | null = null
	private isDestroyed = false

	constructor(
		public readonly game: Game,
		into: HTMLElement
	) {
		this.game.renderer = this
		this.container = into
		this.initialize(into).catch((e) => {
			console.error('[PixiGameRenderer] initialize failed:', e)
		})
	}

	public async initialize(_element: HTMLElement) {
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

		// Setup Drag Preview Overlay
		this.dragPreviewOverlay = new DragPreviewOverlay(this)
		this.dragPreviewOverlay.bind()

		// Register for HMR
		registerPixiApp(this.app)

		// Signal that renderer is ready and textures can be requested
		if ((this.game as any).rendererReadyResolver) {
			;(this.game as any).rendererReadyResolver()
		}
	}

	public layers!: {
		ground: RenderLayer
		alveoli: RenderLayer
		resources: RenderLayer
		storedGoods: RenderLayer // e.g. on borders
		looseGoods: RenderLayer
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
			alveoli: setPixiName(new RenderLayer(), 'layer.alveoli'), // structures
			resources: setPixiName(new RenderLayer(), 'layer.resources'), // resources
			storedGoods: setPixiName(new RenderLayer(), 'layer.storedGoods'),
			looseGoods: setPixiName(new RenderLayer(), 'layer.looseGoods'), // loose goods
			characters: setPixiName(new RenderLayer(), 'layer.characters'),
			ui: setPixiName(new Container(), 'layer.ui'), // UI remains in world? Or screen?
			// Usually UI is screen space. Let's keep UI separate or check usage.
			// GameWidget.vue overlay is DOM based. In-game UI usually stays on screen.
			// For now, let's put UI on stage (screen space) and others in world.
		}

		this.layers.ground.sortableChildren = true
		this.layers.alveoli.sortableChildren = true
		this.layers.resources.sortableChildren = true
		this.layers.storedGoods.sortableChildren = true
		this.layers.looseGoods.sortableChildren = true
		this.layers.characters.sortableChildren = true

		this.world.sortableChildren = true
		this.world.addChild(
			this.worldScene,
			this.layers.ground, // terrain
			this.layers.alveoli, // structures
			this.layers.resources, // NEW
			this.layers.storedGoods,
			this.layers.looseGoods, // NEW
			this.layers.characters
		)

		// Explicit Z-Index to ensure order
		// - tile background (terrain)
		// - buildings (structures)
		// - resources
		// - stored goods
		// - loose goods
		// - characters

		this.layers.ground.zIndex = 0 // terrain
		this.layers.alveoli.zIndex = 10 // buildings
		this.layers.resources.zIndex = 20 // resources
		this.layers.storedGoods.zIndex = 30 // stored goods
		this.layers.looseGoods.zIndex = 40 // loose goods
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
		this.app.renderer.resize(width, height)
		this.terrainVisual?.invalidate()
	}

	public invalidateTerrain() {
		this.terrainVisual?.invalidate()
	}

	public invalidateTerrainHard() {
		this.terrainVisual?.invalidate(true)
	}

	public getTerrainDiagnostics(): TerrainStreamingDiagnostics | undefined {
		return this.terrainVisual?.getDiagnostics()
	}

	// Resource management
	public getTexture(spec: string): Texture {
		return assetManager.getTexture(spec)
	}

	public destroy() {
		this.isDestroyed = true

		this.interactionManager?.teardown()
		this.dragPreviewOverlay?.dispose()
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
	}

	public async reload() {
		this.destroy()
		this.isDestroyed = false
		await this.initialize(this.container)
	}
}
