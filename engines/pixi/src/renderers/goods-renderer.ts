import { Container, Graphics, Sprite, ColorMatrixFilter } from 'pixi.js'
import { namedEffect } from 'ssh/src/lib/debug'
import type { GoodType } from 'ssh/src/lib/types/base'
import type { PixiGameRenderer } from '../renderer'
import { goods as goodsCatalog } from '../../assets/visual-content'

const sharedGrayscaleFilter = new ColorMatrixFilter()
sharedGrayscaleFilter.desaturate()

export interface RenderedGoodSlot {
	goodType: GoodType
	present: number
	reserved: number
	allocated: number
	allowed: number
}

export class GoodsRenderer {
    static render(
        renderer: PixiGameRenderer,
        container: Container,
        size: number,
        getSlots: () => { slots: RenderedGoodSlot[], assumedMaxSlots?: number },
        worldPosition: { x: number; y: number },
        label: string
    ) {
        const root = new Container()
        root.position.set(worldPosition.x, worldPosition.y)
        container.addChild(root)

        const cleanup = namedEffect(label, () => {
            root.removeChildren().forEach(c => c.destroy())
            
            const { slots, assumedMaxSlots } = getSlots()
            if (slots.length === 0) return



            const n = assumedMaxSlots ?? slots.length
            const [centerIndex, around] = n === 1 || n === 5 ? [0, n - 1] : [-1, n]
            const radius = size * 0.4
            const spriteSize = size * 0.5

            for (let i = 0; i < slots.length; i++) {
                const slot = slots[i]
                const goodDef = goodsCatalog[slot.goodType as string]
                if (!goodDef || !goodDef.sprites) {
                    console.warn('[GoodsRenderer] Missing visual definition for good:', slot.goodType)
                    continue
                }

                let [x, y] = [0, 0]
                if (centerIndex !== i) {
                    const angle = (i * 2 * Math.PI) / around
                    x = Math.cos(angle) * radius
                    y = Math.sin(angle) * radius
                }

                const texture = renderer.getTexture(goodDef.sprites[0])
                if (!texture || texture ===  (renderer as any).getTexture('empty')) { // Check for empty/white
                     console.warn('[GoodsRenderer] Texture missing for:', goodDef.sprites[0])
                     // continue // Don't continue, let it render white square if enabled
                }
                if (!texture) continue
                
                const scale = spriteSize / texture.height
                const dy = spriteSize / 4
                const totalHeight = (slot.allowed + 1) * dy
                const presentOffset = dy - totalHeight / 2
                
                // Gauge
                const gaugeWidth = spriteSize * 0.6
                const gauge = new Graphics()
                    .rect(x - gaugeWidth / 2, y - totalHeight / 2, gaugeWidth, totalHeight)
                    .fill({ color: 0x000080, alpha: 0.5 })
                root.addChild(gauge)

                const drawSprites = (count: number, offset: number, tint = 0xffffff, alpha = 1, filter?: boolean) => {
                    for (let q = 0; q < count; q++) {
                        const s = new Sprite(texture)
                        s.scale.set(scale)
                        s.anchor.set(0.5)
                        s.position.set(x, y - q * dy - offset)
                        s.tint = tint
                        s.alpha = alpha
                        if (filter) s.filters = [sharedGrayscaleFilter]
                        root.addChild(s)
                    }
                }

                drawSprites(slot.present, presentOffset)
                const reservedOffset = presentOffset + slot.present * dy
                drawSprites(slot.reserved, reservedOffset, 0xff6666, 0.7)
                const allocatedOffset = reservedOffset + slot.reserved * dy
                drawSprites(slot.allocated, allocatedOffset, 0xffffff, 0.5, true)
            }
        })

        return () => {
            cleanup()
            root.destroy({ children: true })
            container.removeChild(root)
        }
    }
}
