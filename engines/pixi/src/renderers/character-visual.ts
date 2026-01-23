import { ColorMatrixFilter, Container, Sprite } from 'pixi.js'
import { namedEffect } from 'ssh/src/lib/debug'
import type { Character } from 'ssh/src/lib/population/character'
import { mrg } from 'ssh/src/lib/interactive-state'
import { VisualObject } from './visual-object'
import { toWorldCoord } from 'ssh/src/lib/utils/position' // Verify path
import { tileSize } from 'ssh/src/lib/utils/varied'
import type { PixiGameRenderer } from '../renderer'
import { GoodsRenderer } from './goods-renderer'

export class CharacterVisual extends VisualObject<Character> {
    private sprite: Sprite
    private vehicleSprite: Sprite
    
    constructor(character: Character, renderer: PixiGameRenderer) {
        super(character, renderer)
        
        // Create container structure
        const charTex = renderer.getTexture('characters.default')
        this.sprite = new Sprite((charTex && (charTex as any).orig) ? charTex : renderer.getTexture('empty'))
        this.sprite.anchor.set(0.5, 0.5)
        // User feedback: 90% (36px instead of 40px)
        this.sprite.width = 36
        this.sprite.height = 36
        
        const vehTex = renderer.getTexture('vehicles.byHands')
        this.vehicleSprite = new Sprite((vehTex && (vehTex as any).orig) ? vehTex : renderer.getTexture('empty'))
        this.vehicleSprite.anchor.set(0.5, 0.5)
        this.vehicleSprite.width = 30
        this.vehicleSprite.height = 30
        this.vehicleSprite.position.set(0, this.sprite.height * 0.15)
        
        this.view.addChild(this.sprite)
        this.view.addChild(this.vehicleSprite)
    }

    public bind() {
        // Position binding
        this.register(namedEffect('character.position', () => {
             const world = toWorldCoord(this.object.position)
             // Need tileSize or similar context? toWorldCoord handles it if imports are correct
             if (world) this.view.position.set(world.x, world.y)
        }))

        // Hover effect
		const brightnessFilter = new ColorMatrixFilter()
        this.register(namedEffect(`character.${this.object.uid}.mouseover`, () => {
			if (mrg.hoveredObject?.uid === this.object.uid) {
				this.sprite.tint = 0xaaaaff
				brightnessFilter.brightness(1.2, false)
				this.sprite.filters = [brightnessFilter]
			} else {
				this.sprite.tint = 0xffffff
				this.sprite.filters = [] 
			}
		}))
        
        // 2. Render Goods
        const cleanupGoods = GoodsRenderer.render(
            this.renderer,
            this.view,
            tileSize, // Slightly smaller for characters
            () => {
                const goods = this.object.carry?.renderedGoods()
                return { slots: goods ? goods.slots : [] }
            },
            { x: 0, y: 0 },
            `goods.render.${this.object.uid}`
        )
        this.register(cleanupGoods)
    }
}
