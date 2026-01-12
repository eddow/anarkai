import { Assets, Texture, Spritesheet } from 'pixi.js'
import { deposits, alveoli, goods, vehicles, terrain, characters, commands } from '../assets/visual-content'

export class PixiAssetManager {
    private assetMap = new Map<string, Texture>()
    private assetsLoaded = false
    private loadingPromise: Promise<void> | null = null

    public async load() {
        if (this.assetsLoaded) return
        if (this.loadingPromise) return this.loadingPromise

        this.loadingPromise = this.loadAssetsInternal()
        await this.loadingPromise
        this.assetsLoaded = true
    }

    private async loadAssetsInternal() {
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
            if (def.background) {
                assetKeys.add(def.background)
            } else {
                assetKeys.add(`terrain.${key}`)
            }
        }
        
        // Build asset bundles from extracted keys
        const assetsToLoad: Record<string, string> = {}
        
        for (const key of assetKeys) {
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
        
        console.log('[PixiAssetManager] Loading Assets:', assetsToLoad)
        Assets.addBundle('game-assets', assetsToLoad)
        
        let loaded: Record<string, any> = {};
        try {
             loaded = await Assets.loadBundle('game-assets')
        } catch(e) {
             console.error('[PixiAssetManager] Assets.loadBundle failed, proceeding with empty assets.', e)
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

        // Add Terrain Aliases defined in visual-content
        for (const [key, def] of Object.entries(terrain)) {
            const aliasKey = `terrain.${key}`
            
            // If explicit background is set, start aliasing/mapping
            if (def.background) {
                const targetKey = def.background
                if (this.assetMap.has(targetKey)) {
                     this.assetMap.set(aliasKey, this.assetMap.get(targetKey)!)
                } else {
                    console.warn(`[PixiAssetManager] Missing target asset for terrain alias: ${aliasKey} -> ${targetKey}`)
                }
            } else {
                 // For implicit keys (e.g. terrain.forest), they should verify they exist
                 if (!this.assetMap.has(aliasKey)) {
                      console.warn(`[PixiAssetManager] Implicit terrain asset missing: ${aliasKey}`)
                 }
            }
        }
        
        console.log('[PixiAssetManager] Assets Loaded', Object.keys(loaded))
    }

    public getTexture(spec: string): Texture {
        if (!spec) return Texture.WHITE
        
        // 1. Try direct lookup in our asset map
        if (this.assetMap.has(spec)) {
            const t = this.assetMap.get(spec)!
            if (!(t as any).orig) {
                console.warn(`[PixiAssetManager] AssetMap Texture ${spec} missing orig.`, t)
                return Texture.WHITE
            }
            return t
        }
        
        // 2. Fallbacks / Mapping Logic (Specials)
        if (spec === 'deposits.tree') return this.getTexture('objects.trees/tree1') 
        if (spec === 'deposits.rock') return this.getTexture('objects.rocks/rock1')
        if (spec === 'deposits.berry_bush') return this.getTexture('objects.bushes/bush1')
        
        // Existing partial matches (legacy support)
        if (spec.startsWith('objects.trees') && spec !== 'objects.trees/tree1') return this.getTexture('objects.trees/tree1')
        if (spec.startsWith('objects.rocks') && spec !== 'objects.rocks/rock1') return this.getTexture('objects.rocks/rock1')
        if (spec.startsWith('objects.bushes') && spec !== 'objects.bushes/bush1') return this.getTexture('objects.bushes/bush1')

        return Texture.WHITE
    }
}

export const assetManager = new PixiAssetManager()
