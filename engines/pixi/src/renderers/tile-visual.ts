import { ColorMatrixFilter, Container, Graphics, Point, TilingSprite } from 'pixi.js'
import { namedEffect } from 'ssh/src/lib/debug'
import { interactionMode, mrg } from 'ssh/src/lib/interactive-state'
import { tileSize } from 'ssh/src/lib/utils/varied'
import { toWorldCoord } from 'ssh/src/lib/utils/position'
import type { Tile } from 'ssh/src/lib/board/tile'
import type { PixiGameRenderer } from '../renderer'
import { VisualObject } from './visual-object'
import { Alveolus } from 'ssh/src/lib/board/content/alveolus'
import { UnBuiltLand } from 'ssh/src/lib/board/content/unbuilt-land'
import { AlveolusVisual } from './alveolus-visual'
import { UnBuiltLandVisual } from './unbuilt-land-visual'

export class TileVisual extends VisualObject<Tile> {
    private tileContainer: Container
    private backgroundSprite: TilingSprite
    private contentContainer: Container
    private zoneBorder: Graphics
    
    // Cache for interaction state to avoid redundant updates
    private cachedBrightness = 1
    private cachedTint = 0xffffff
    private cachedBorderColor = 0


    constructor(tile: Tile, renderer: PixiGameRenderer) {
        super(tile, renderer)
        
        this.tileContainer = new Container()
        this.view.addChild(this.tileContainer)
        
        // Setup layers
        const backgroundLayer = new Container()
        this.contentContainer = new Container()
        this.tileContainer.addChild(backgroundLayer, this.contentContainer)
        
        this.zoneBorder = new Graphics()
        this.tileContainer.addChild(this.zoneBorder)

        // Initialize background (won't change often)
        const bgTex = renderer.getTexture('terrain.grass')
        this.backgroundSprite = new TilingSprite({
            texture: (bgTex && (bgTex as any).orig) ? bgTex : renderer.getTexture('empty'),
            width: tileSize * 2,
            height: tileSize * 2
        })
        this.backgroundSprite.anchor.set(0.5)
        
        // Hex mask
        const mask = new Graphics()
        const points = Array.from({ length: 6 }, (_, i) => {
            const angle = (Math.PI / 3) * (i + 0.5)
            return new Point(Math.cos(angle) * tileSize, Math.sin(angle) * tileSize)
        })
        mask.poly(points).fill(0xffffff)
        this.backgroundSprite.mask = mask
        backgroundLayer.addChild(this.backgroundSprite, mask)

        // Position
        const world = toWorldCoord(tile.position)
        if (world) {
            this.view.position.set(world.x, world.y)
             // Tiling sprite offset for seamless texture
           this.backgroundSprite.tilePosition.set(
               -world.x % (this.backgroundSprite.texture.width || tileSize), 
               -world.y % (this.backgroundSprite.texture.height || tileSize)
           )
        }
    }


    private currentContentVisual: VisualObject<any> | undefined

    public bind() {
        const brightnessFilter = new ColorMatrixFilter()
        
        // React to content changes and specific interactions
        this.register(namedEffect(`tile.${this.object.uid}.render`, () => {
             const content = this.object.content
             
             // Manage Content Visual
             if (this.currentContentVisual && this.currentContentVisual.object !== content) {
                 this.currentContentVisual.dispose()
                 this.currentContentVisual = undefined
             }
             
             if (content && !this.currentContentVisual) {
                 if (content instanceof Alveolus) {
                     this.currentContentVisual = new AlveolusVisual(content, this.renderer)
                     this.currentContentVisual.bind()
                     // Decoupled: Visual attaches itself to correct layer
                     // this.contentContainer.addChild(this.currentContentVisual.view)
                 } else if (content instanceof UnBuiltLand) {
                     this.currentContentVisual = new UnBuiltLandVisual(content, this.renderer)
                     this.currentContentVisual.bind()
                     // Decoupled: Visual attaches itself to correct layer
                     // this.contentContainer.addChild(this.currentContentVisual.view)
                 }
             }

             // Update background texture based on content
             if (content) {
                 let bgName = (content as any).background
                 if (bgName) {
                    if (!bgName.includes('.')) {
                        bgName = `terrain.${bgName}`
                    }
                     const tex = this.renderer.getTexture(bgName)
                     if (!tex || tex === (this.renderer as any).getTexture('empty')) {
                         // console.warn(`[TileVisual] Missing bg texture: ${bgName} (orig: ${(content as any).background})`)
                     }
                     this.backgroundSprite.texture = tex
                 }
             }
        }))

        this.register(namedEffect(`tile.${this.object.uid}.interaction`, () => {
             const content = this.object.content
             // Handle Hover/Selection State (Logic reused from previous TileContent.render)
            let brightness = 1
            let tint = 0xffffff
            let borderColor = 0

			if (mrg.hoveredObject?.uid === this.object.uid) {
				const action = interactionMode.selectedAction
                const canInteract = content && (content as any).canInteract && (content as any).canInteract(action)
                
				if (action && canInteract) {
					if (action.startsWith('zone:')) {
						const zoneType = action.replace('zone:', '')
                        // simplified zone colors
						tint = zoneType === 'residential' ? 0x88ff88 : (zoneType === 'harvest' ? 0xddbb99 : 0xbbbbbb)
                        brightness = 1.1
					} else {
						tint = 0xaaaaff
						brightness = 1.2
					}
				} else if (!action || action === '' || action === 'select') {
					tint = 0xaaaaff
					brightness = 1.2
				}
			}
            
            // Zone coloring from content
            if (content && (content as any).colorCode) {
                 // Explicitly access colorCode as optional method
                 const cc = typeof (content as any).colorCode === 'function' ? (content as any).colorCode() : null
                 if (cc) {
                    if (mrg.hoveredObject?.uid !== this.object.uid) { // Don't override hover tint completely?
                        if (cc.tint) tint = cc.tint
                    }
                    if (cc.borderColor) borderColor = cc.borderColor
                 }
            }

            // OPTIMIZATION: Only update if values changed
            const tintChanged = this.cachedTint !== tint
            const brightnessChanged = this.cachedBrightness !== brightness
            const borderChanged = this.cachedBorderColor !== borderColor
            
            if (tintChanged) {
                this.backgroundSprite.tint = tint
                this.cachedTint = tint
            }
            
			if (brightnessChanged) {
                this.cachedBrightness = brightness
				if (brightness !== 1) {
					brightnessFilter.brightness(brightness, false)
					this.backgroundSprite.filters = [brightnessFilter]
				} else {
					this.backgroundSprite.filters = []
				}
			}
            
            // Draw border only if it changed
			if (borderChanged) {
                this.cachedBorderColor = borderColor
				this.zoneBorder.clear()
				if (borderColor) {
					const innerSize = tileSize - 3 / 4 // borderWidth=3
					const points = Array.from({ length: 6 }, (_, i) => {
						const angle = (Math.PI / 3) * (i + 0.5)
						return new Point(Math.cos(angle) * innerSize, Math.sin(angle) * innerSize)
					})
					this.zoneBorder.poly(points).stroke({ width: 1.5, color: borderColor })
				}
			}
        }))
    }
    
    public dispose() {
        this.currentContentVisual?.dispose()
        super.dispose()
    }
}
