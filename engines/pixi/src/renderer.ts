import { Application, Container, Texture, Spritesheet, Assets } from 'pixi.js'
import type { GameRenderer } from 'ssh/src/lib/types/engine'
import type { Game } from 'ssh/src/lib/game/game'
import { registerPixiApp, unregisterPixiApp } from './hmr.js'
import { InteractionManager } from './interaction/interaction-manager.js'

import { VisualFactory } from './visual-factory'
import { deposits, alveoli, goods, vehicles, terrain, characters, commands } from '../assets/visual-content.js'

export class PixiGameRenderer implements GameRenderer {
	public app?: Application
	public stage?: Container
    private interactionManager?: InteractionManager
    private visualFactory?: VisualFactory
	private container: HTMLElement
	private canvas: HTMLCanvasElement | null = null
	private isDestroyed = false

	constructor(
		public readonly game: Game,
		into: HTMLElement,
	) {
		this.game.renderer = this
		this.container = into
		this.initialize(into).catch((e) => {
			console.error('[PixiGameRenderer] initialize failed:', e)
		})
	}

	public async initialize(element: HTMLElement) {
		if (this.isDestroyed) return

		this.app = new Application()
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
        await this.loadAssets()

        // Setup Layers (MUST be before InteractionManager so world exists)
        this.setupLayers()

        // Setup Interaction
        this.interactionManager = new InteractionManager(this.app, this.game)
        this.interactionManager.setup()

        // Setup Visuals
        this.visualFactory = new VisualFactory(this)
        this.visualFactory.bind()

		// Register for HMR
		registerPixiApp(this.app)
	}

    public layers!: {
        ground: Container
        alveoli: Container
        characters: Container
        storedGoods: Container // e.g. on borders
        ui: Container // in-game ui overlays
    }
    
    // Map Logic Object UID -> Visual Object
    public visuals = new Map<string, any>()
    public missingTextures: string[] = []

    public world!: Container

    private setupLayers() {
        if (!this.stage) return
        
        // World container holds all game content and acts as the camera
        this.world = new Container()
        this.stage.addChild(this.world)

        this.layers = {
            ground: new Container(),
            alveoli: new Container(),
            storedGoods: new Container(),
            characters: new Container(),
            ui: new Container() // UI remains in world? Or screen?
            // Usually UI is screen space. Let's keep UI separate or check usage.
            // GameWidget.vue overlay is DOM based. In-game UI usually stays on screen.
            // For now, let's put UI on stage (screen space) and others in world.
        }
        
        this.world.addChild(
            this.layers.ground,
            this.layers.alveoli,
            this.layers.storedGoods,
            this.layers.characters
        )
        // Add UI directly to stage so it doesn't zoom/pan
        this.layers.ui = new Container()
        this.stage.addChild(this.layers.ui)
    }

    private setupVisuals() {
    }

    private assetsLoaded = false
    private assetMap = new Map<string, Texture>()
    
    // Map 'visual-content.ts' keys to actual file paths (approximate manual mapping)
    // In a real scenario, this would be data-driven or a strict convention.
    // Based on find_by_name: engines/pixi/assets/terrain/grass.jpg -> /pixi-assets/terrain/grass.jpg
    private async loadAssets() {
        if (this.assetsLoaded) return

        const assetBase = '/pixi-assets'
        
        // Dynamically extract all asset keys from visual-content
        const assetKeys = new Set<string>()
        
        // Helper to extract sprite keys from visual definitions
        const extractKeys = (definitions: Record<string, any>) => {
            for (const def of Object.values(definitions)) {
                if (def.sprites) {
                    for (const sprite of def.sprites) {
                        assetKeys.add(sprite)
                    }
                }
                if (def.icon) assetKeys.add(def.icon)
                if (def.background) assetKeys.add(def.background)
            }
        }
        
        // Extract from all visual content modules
        extractKeys(deposits)
        extractKeys(alveoli)
        extractKeys(goods)
        extractKeys(vehicles)
        extractKeys(characters)
        extractKeys(commands)
        
        // Terrain is special: keys imply assets 'terrain.NAME' only if definition doesn't override it
        for (const [key, def] of Object.entries(terrain)) {
            // If definition has explicit background, we use that (extracted above).
            // If NO background is defined, we assume 'terrain.key' exists.
            if (!def.background) {
                assetKeys.add(`terrain.${key}`)
            }
        }
        extractKeys(terrain) // RESTORED
        
        // Build asset bundles from extracted keys
        const assetsToLoad: Record<string, string> = {}
        
        for (const key of assetKeys) {
            // ... (keep existing logic)
            // 1. Spritesheets
            if (key.includes('/')) {
                const [sheetName, _frame] = key.split('/')
                if (!assetsToLoad[sheetName]) {
                    const [category, name] = sheetName.split('.')
                    assetsToLoad[sheetName] = `${assetBase}/${category}/${name}.json`
                }
                continue
            }
            
            // 2. Direct assets
            const parts = key.split('.')
            if (parts.length === 2) {
                const [category, name] = parts
                
                let ext = 'png'
                if (category === 'terrain') ext = 'jpg'
                
                let fileName = name
                if (category === 'vehicles') {
                     fileName = name.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '')
                }
                
                assetsToLoad[key] = `${assetBase}/${category}/${fileName}.${ext}`
            }
        }
        
        console.log('[PixiGameRenderer] Loading Assets:', assetsToLoad)
        Assets.addBundle('game-assets', assetsToLoad)
        let loaded = {};
        try {
             loaded = await Assets.loadBundle('game-assets')
        } catch(e) {
             console.error('[PixiGameRenderer] Assets.loadBundle failed, proceeding with empty assets.', e)
        }

        // Populate Cache/Map
        for (const [key, resource] of Object.entries(loaded)) {
            if (resource instanceof Texture) {
                this.assetMap.set(key, resource)
            } else if (resource instanceof Spritesheet) {
                for (const [frameName, tex] of Object.entries(resource.textures)) {
                    this.assetMap.set(frameName, tex)
                    this.assetMap.set(`${key}/${frameName}`, tex)
                }
            }
        }

        // Add overrides for goods which might be simple sprites but loaded via keys
        // ... (goods logic)

        // Add Terrain Aliases defined in visual-content
        // e.g. 'rocky' -> 'terrain.stone'. 
        // We loaded 'terrain.stone'. Logic asks for 'terrain.rocky'.
        for (const [key, def] of Object.entries(terrain)) {
            if (def.background) {
                const targetKey = def.background
                const aliasKey = `terrain.${key}`
                if (targetKey !== aliasKey && this.assetMap.has(targetKey)) {
                    this.assetMap.set(aliasKey, this.assetMap.get(targetKey)!)
                }
            }
        }
        
        this.assetsLoaded = true
        console.log('[PixiGameRenderer] Assets Loaded', Object.keys(loaded))
    }

	public resize(width: number, height: number) {
		if (!this.app?.renderer) return
		this.app.renderer.resize(width, height)
	}

    // Resource management
    public getTexture(spec: string): Texture {
        if (!spec) return Texture.WHITE
        
        // 1. Try direct lookup in our asset map
        if (this.assetMap.has(spec)) {
            const t = this.assetMap.get(spec)!
            if (!(t as any).orig) {
                console.warn(`[PixiGameRenderer] AssetMap Texture ${spec} missing orig.`, t)
                return Texture.WHITE
            }
            return t
        }
        
        // 2. Fallbacks / Mapping Logic (Specials)
        let texture = Texture.WHITE
        if (spec === 'deposits.tree') texture = this.getTexture('objects.trees/tree1') 
        else if (spec === 'deposits.rock') texture = this.getTexture('objects.rocks/rock1')
        else if (spec === 'deposits.berry_bush') texture = this.getTexture('objects.bushes/bush1')
        
        // Existing partial matches (legacy support)
        else if (spec.startsWith('objects.trees') && spec !== 'objects.trees/tree1') texture = this.getTexture('objects.trees/tree1')
        else if (spec.startsWith('objects.rocks') && spec !== 'objects.rocks/rock1') texture = this.getTexture('objects.rocks/rock1')
        else if (spec.startsWith('objects.bushes') && spec !== 'objects.bushes/bush1') texture = this.getTexture('objects.bushes/bush1')
        else {
             // Console error for missing textures (commented to reduce spam)
             // if (spec !== 'empty') {
             //    console.warn(`[PixiGameRenderer] Texture not found: ${spec}.`)
             //    this.missingTextures.push(spec)
             // }
             texture = Texture.WHITE
        }

        // Defensive check for Pixi 8 crash
        if (texture && !(texture as any).orig) {
            return Texture.WHITE
        }
        return texture
    }

	public destroy() {
		this.isDestroyed = true
        
        this.interactionManager?.teardown()
        // this.visualFactory?.destroy()

		if (this.app) {
			unregisterPixiApp(this.app)
			this.app.destroy({
                removeView: true,
                releaseGlobalResources: false // Don't release global assets to allow reload
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
