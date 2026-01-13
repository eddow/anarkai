import { Container, Sprite, Texture } from 'pixi.js'
import { namedEffect } from 'ssh/src/lib/debug'
import type { FreeGoods, FreeGood } from 'ssh/src/lib/game/board/freeGoods'
import { tileSize } from 'ssh/src/lib/utils/varied'
import { toWorldCoord } from 'ssh/src/lib/utils/position' // Verify import
import { goods as goodsCatalog } from '../../assets/visual-content' 
import type { PixiGameRenderer } from '../renderer'
import { VisualObject } from './visual-object'

export class FreeGoodsVisual extends VisualObject<FreeGoods> {
    private spritePool: Sprite[] = []
    private activeSprites = new Map<FreeGood, Sprite>()
    private container: Container

    constructor(freeGoods: FreeGoods, renderer: PixiGameRenderer) {
        super(freeGoods, renderer)
        this.container = new Container()
        // Ensure this container (and its children) does not block mouse events
        this.container.eventMode = 'none'
        this.renderer.layers.looseGoods.addChild(this.container)
    }

    public bind() {
        this.register(namedEffect('freeGoods.render', () => {
             // We need to iterate over all goods.
             // FreeGoods.goods is a Map<AxialKey, FreeGood[]>
             // Ideally we iterate only visible processing, but here we do all for simplicity first.
             
             // Track seen goods to remove vanished ones
             const seen = new Set<FreeGood>()

             // console.log('[FreeGoodsVisual] Rendering. Goods entries:', Array.from((this.object as any).goods.entries()).length)

             for (const [coordKey, goodsList] of (this.object as any).goods.entries()) {
                 for (const good of goodsList) {
                     // Log first good found
                     // console.log('[FreeGoodsVisual] Good:', good.goodType, good.available, good.position)
                     
                     // FIX: Allocated goods should still be visible until removed!
                     // if (!good.available) continue 
                     
                     seen.add(good)
                     let sprite = this.activeSprites.get(good)
                     if (!sprite) {
                         sprite = this.getSprite()
                         this.activeSprites.set(good, sprite)
                         this.container.addChild(sprite)
                         
                         
                         const def = (goodsCatalog as any)[good.goodType]
                         if (def && def.sprites && def.sprites[0]) {
                             const textureKey = def.sprites[0]
                             const texture = this.renderer.getTexture(textureKey)
                             sprite.texture = texture
                             
                             if (texture === Texture.WHITE) {
                                 console.warn('[FreeGoodsVisual] Missing texture for:', textureKey)
                             }

                             // Scale?
                             const scale = (tileSize * 0.5) / (sprite.texture.height || 20)
                             sprite.scale.set(scale)
                         } else {
                             console.warn('[FreeGoodsVisual] No definition for goodType:', good.goodType)
                         }
                     }
                     
                     // Update position for both new and existing sprites
                     const world = toWorldCoord(good.position) // Position might be Positioned or string?
                     // Good position is usually 'Position'.
                     if (world) {
                         sprite.position.set(world.x, world.y)
                     } else {
                         console.warn('[FreeGoodsVisual] Invalid world pos for good:', good.position)
                     }
                 }
             }

             // Cleanup removed goods
             for (const [good, sprite] of this.activeSprites) {
                 if (!seen.has(good)) {
                     this.returnSprite(sprite)
                     this.activeSprites.delete(good)
                 }
             }
        }))
    }
    
    private getSprite(): Sprite {
        const s = this.spritePool.pop() || new Sprite()
        s.anchor.set(0.5)
        return s
    }
    
    private returnSprite(s: Sprite) {
        s.parent?.removeChild(s)
        this.spritePool.push(s)
    }

    public dispose() {
        this.container.destroy({ children: true }) // destroys all sprites
        super.dispose()
    }
}
