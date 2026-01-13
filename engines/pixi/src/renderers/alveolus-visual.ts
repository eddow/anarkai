import { Container, Sprite } from 'pixi.js'
import { namedEffect } from 'ssh/src/lib/debug'
import type { Alveolus } from 'ssh/src/lib/game/board/content/alveolus'
import { toWorldCoord } from 'ssh/src/lib/utils/position'
import { tileSize } from 'ssh/src/lib/utils/varied'
import { alveoli } from '../../assets/visual-content'
import type { PixiGameRenderer } from '../renderer'
import { GoodsRenderer } from './goods-renderer'
import { VisualObject } from './visual-object'


export class AlveolusVisual extends VisualObject<any> {
    private sprite: Sprite | undefined
    private goodsContainer: Container

    constructor(alveolus: Alveolus, renderer: PixiGameRenderer) {
        super(alveolus, renderer)
        // Ensure the building visual does not block mouse events (Tile handles selection)
        this.view.eventMode = 'none'
        this.goodsContainer = new Container()
    }

    public bind() {
        const worldPos = toWorldCoord(this.object.tile.position)
        
        // Attach view to structures layer
        this.view.position.set(worldPos.x, worldPos.y)
        this.renderer.layers.alveoli.addChild(this.view)
        
        // 1. Render Structure Sprite (on alveoli layer)
        this.register(namedEffect(`alveolus.${this.object.uid}.sprite`, () => {
             const visualDef = alveoli[this.object.name]
             const textureName = visualDef?.sprites?.[0]
             if (textureName) {
                 const tex = this.renderer.getTexture(textureName)
                 if (tex && (tex as any).orig) {
                     if (!this.sprite) {
                         this.sprite = new Sprite()
                         this.sprite.anchor.set(0.5)
                         this.sprite.position.set(0, 0)  // Relative to this.view
                         this.view.addChild(this.sprite)
                     }
                     this.sprite.texture = tex
                     
                     // Smart scaling - User feedback: 9/8 (1.125)
                     const targetSize = tileSize * (9 / 8)
                     const maxDim = Math.max(this.sprite.texture.width, this.sprite.texture.height)
                     
                     if (maxDim > 1) {
                        const scale = targetSize / maxDim
                        this.sprite.scale.set(scale)
                     } else {
                         this.sprite.scale.set(1)
                     }
                 }
             } else {
                 if (this.sprite) {
                     this.sprite.destroy()
                     this.sprite = undefined
                 }
             }
        }))

        // 2. Render Goods (on storedGoods layer)
        // Goods need to be on a higher layer
        this.goodsContainer.position.set(worldPos.x, worldPos.y)
        this.renderer.layers.storedGoods.addChild(this.goodsContainer)
        
        const cleanupGoods = GoodsRenderer.render(
            this.renderer,
            this.goodsContainer,
            tileSize,
            () => {
                const goods = this.object.storage?.renderedGoods()
                return { slots: goods ? goods.slots : [] }
            },
            { x: 0, y: 0 },  // Relative since goodsContainer is at worldPos
            `goods.render.${this.object.uid}`
        )
        this.register(cleanupGoods)
    }

    public dispose() {
        if (this.sprite) {
            this.sprite.destroy()
        }
        this.goodsContainer.destroy({ children: true }) // Cleanup goods container
        super.dispose()
    }
}
