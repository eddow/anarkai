import { Assets, Spritesheet, Texture } from 'pixi.js'
import {
	alveoli,
	characters,
	commands,
	deposits,
	dwellings,
	goods,
	roads,
	settlementTargets,
	terrain,
	vehicles,
} from '../assets/visual-content'

const hasUsableTexture = (texture: Texture | undefined) => {
	if (!texture || texture === Texture.WHITE) return false
	const frame = texture.frame
	return frame.width > 0 && frame.height > 0
}

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
		extractKeys(dwellings)
		extractKeys(settlementTargets)

		// Terrain is special: keys imply assets 'terrain.NAME' only if definition doesn't override it
		for (const [key, def] of Object.entries(terrain)) {
			if (def.background) {
				assetKeys.add(def.background)
			} else {
				assetKeys.add(`terrain.${key}`)
			}
		}
		for (const road of Object.values(roads.types)) assetKeys.add(road.texture)

		// Build asset bundles from extracted keys
		const assetsToLoad: Record<string, string> = {
			'unified-spritesheet': `${assetBase}/unified-spritesheet.json`
		}

		for (const key of assetKeys) {
			const parts = key.split('.')
			if (parts.length === 2) {
				const [category, name] = parts
				if (category === 'terrain' || category === 'roads') {
					assetsToLoad[key] = `${assetBase}/${category}/${name}.jpg`
				}
			}
		}

		console.log('[PixiAssetManager] Loading Assets:', assetsToLoad)
		Assets.addBundle('game-assets', assetsToLoad)

		let loaded: Record<string, any> = {}
		try {
			loaded = await Assets.loadBundle('game-assets')
		} catch (e) {
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
					console.warn(
						`[PixiAssetManager] Missing target asset for terrain alias: ${aliasKey} -> ${targetKey}`
					)
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
			if (!hasUsableTexture(t)) {
				console.warn(`[PixiAssetManager] AssetMap Texture ${spec} is not usable.`, t)
				return Texture.WHITE
			}
			return t
		}
		
		// Handle direct root files (e.g., 'bakery', 'clothes', etc.)
		if (!spec.includes('.') && this.assetMap.has(spec)) {
		    return this.assetMap.get(spec)!
		}
		if (!spec.includes('.') && this.assetMap.has(`unified-spritesheet/${spec}`)) {
		    return this.assetMap.get(`unified-spritesheet/${spec}`)!
		}
		
		// Map standalone files that are now in unified spritesheet
		const parts = spec.split('.')
		if (parts.length === 2 && ['buildings', 'characters', 'commands', 'goods', 'vehicles'].includes(parts[0])) {
			let fileName = parts[1]
			if (parts[0] === 'vehicles') {
				fileName = fileName
					.replace(/([A-Z])/g, '-$1')
					.toLowerCase()
					.replace(/^-/, '')
			}
			const unifiedKey = `${parts[0]}.${fileName}`
			if (this.assetMap.has(unifiedKey)) {
				return this.assetMap.get(unifiedKey)!
			} else if (this.assetMap.has(`unified-spritesheet/${unifiedKey}`)) {
				return this.assetMap.get(`unified-spritesheet/${unifiedKey}`)!
			}
		}

		// Handle missing sheet name prefix
		if (this.assetMap.has(`unified-spritesheet/${spec}`)) {
			const t = this.assetMap.get(`unified-spritesheet/${spec}`)!
			if (!hasUsableTexture(t)) {
				return Texture.WHITE
			}
			return t
		}

		// 2. Fallbacks / Mapping Logic (Specials)
		let fallbackSpec = spec
		if (spec === 'deposits.tree') fallbackSpec = 'objects.trees/tree1'
		if (spec === 'deposits.rock') fallbackSpec = 'objects.rocks/rock1'
		if (spec === 'deposits.berry_bush') fallbackSpec = 'objects.bushes/bush1'

		// Existing partial matches (legacy support)
		if (fallbackSpec.startsWith('objects.trees') && fallbackSpec !== 'objects.trees/tree1')
			fallbackSpec = 'objects.trees/tree1'
		if (fallbackSpec.startsWith('objects.rocks') && fallbackSpec !== 'objects.rocks/rock1')
			fallbackSpec = 'objects.rocks/rock1'
		if (fallbackSpec.startsWith('objects.bushes') && fallbackSpec !== 'objects.bushes/bush1')
			fallbackSpec = 'objects.bushes/bush1'
			
		// Re-evaluate mapping with fallbackSpec if it changed
		if (fallbackSpec !== spec) {
		    return this.getTexture(fallbackSpec)
		}

		return Texture.WHITE
	}
}

export const assetManager = new PixiAssetManager()
