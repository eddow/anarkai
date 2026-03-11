import { Application, Container, type Texture } from 'pixi.js'
import type { Game } from 'ssh/game/game'
import type { GameRenderer } from 'ssh/types/engine'
import { assetManager } from './asset-manager'
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
		ground: Container
		alveoli: Container
		resources: Container
		storedGoods: Container // e.g. on borders
		looseGoods: Container
		characters: Container
		ui: Container // in-game ui overlays
	}

	// Map Logic Object UID -> Visual Object
	public visuals = new Map<string, any>()
	public missingTextures: string[] = []

	public world!: Container

	private setupLayers() {
		if (!this.stage) return

		// World container holds all game content and acts as the camera
		this.stage.name = 'renderer.stage'
		this.world = setPixiName(new Container(), 'renderer.world')
		this.stage.addChild(this.world)

		this.layers = {
			ground: setPixiName(new Container(), 'layer.ground'), // terrain
			alveoli: setPixiName(new Container(), 'layer.alveoli'), // structures
			resources: setPixiName(new Container(), 'layer.resources'), // resources
			storedGoods: setPixiName(new Container(), 'layer.storedGoods'),
			looseGoods: setPixiName(new Container(), 'layer.looseGoods'), // loose goods
			characters: setPixiName(new Container(), 'layer.characters'),
			ui: setPixiName(new Container(), 'layer.ui'), // UI remains in world? Or screen?
			// Usually UI is screen space. Let's keep UI separate or check usage.
			// GameWidget.vue overlay is DOM based. In-game UI usually stays on screen.
			// For now, let's put UI on stage (screen space) and others in world.
		}

		this.world.sortableChildren = true
		this.world.addChild(
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

	public resize(width: number, height: number) {
		if (!this.app?.renderer) return
		this.app.renderer.resize(width, height)
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
	}

	public async reload() {
		this.destroy()
		this.isDestroyed = false
		await this.initialize(this.container)
	}
}
