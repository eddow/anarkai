import { Container, Graphics, Sprite } from 'pixi.js'
import { namedEffect } from 'ssh/src/lib/debug'
import type { TileBorder } from 'ssh/src/lib/game/board/border/border'
import { AlveolusGate } from 'ssh/src/lib/game/board/border/alveolus-gate'
import { toWorldCoord } from 'ssh/src/lib/utils/position'
import { tileSize } from 'ssh/src/lib/utils/varied'
import type { PixiGameRenderer } from '../renderer'
import { VisualObject } from './visual-object'
import { GoodsRenderer } from './goods-renderer'

export class BorderVisual extends VisualObject<TileBorder> {
    private gateGraphics: Graphics
    private goodsContainer: Container
    
    constructor(border: TileBorder, renderer: PixiGameRenderer) {
        super(border, renderer)
        this.gateGraphics = new Graphics()
        this.goodsContainer = new Container()
        
        // Borders are rendered on storedGoods layer usually (for gates) or ground layer?
        // Gates are "connections" between alveoli.
        // Let's use alveoli layer for the structure/line, storedGoods for goods.
        
        this.renderer.layers.alveoli.addChild(this.gateGraphics)
        this.renderer.layers.storedGoods.addChild(this.goodsContainer)
    }

    public bind() {
         const worldPos = toWorldCoord(this.object.position) // Border position is mid-point
         
         this.register(namedEffect(`border.${this.object.uid}.render`, () => {
             this.gateGraphics.clear()
             this.goodsContainer.removeChildren()
             
             const content = this.object.content
             
             if (content instanceof AlveolusGate) {
                 return this.renderGate(content, worldPos)
             }
         }))
    }
    
    private renderGate(gate: AlveolusGate, center: {x: number, y: number}) {
		// Logic ported from AlveolusGate.render
		const tileAWorld = toWorldCoord(this.object.tile.a.position)
		const alveolusCenter = {
			x: tileAWorld.x - center.x,
			y: tileAWorld.y - center.y,
		}
		const alveolus2Center = { x: -alveolusCenter.x, y: -alveolusCenter.y }
		const centerLine = {
			dx: alveolus2Center.x - alveolusCenter.x,
			dy: alveolus2Center.y - alveolusCenter.y,
		}
		const borderDirection = {
			dx: -centerLine.dy,
			dy: centerLine.dx,
		}
		const borderLength = Math.sqrt(borderDirection.dx ** 2 + borderDirection.dy ** 2)
		const normalizedBorder = {
			dx: borderDirection.dx / borderLength,
			dy: borderDirection.dy / borderLength,
		}

		const lineLength = tileSize * 0.8 
		const startPos = {
			x: center.x - (lineLength / 2) * normalizedBorder.dx,
			y: center.y - (lineLength / 2) * normalizedBorder.dy,
		}
		const endPos = {
			x: center.x + (lineLength / 2) * normalizedBorder.dx,
			y: center.y + (lineLength / 2) * normalizedBorder.dy,
		}

		// Draw the yellow line
		this.gateGraphics
			.moveTo(startPos.x, startPos.y)
			.lineTo(endPos.x, endPos.y)
			.stroke({ color: 0xffff00, width: 2, alpha: 0.7 })

        // Render goods
        return this.renderBorderGoods(gate, center, borderDirection, lineLength)
    }

    private renderBorderGoods(
        gate: AlveolusGate, 
        center: {x: number, y: number}, 
        direction: {dx: number, dy: number}, 
        length: number
    ) {
         // Storage access
         const storage = gate.storage
         if (!storage) return

         return namedEffect(`border.${this.object.uid}.goods`, () => {
             this.goodsContainer.removeChildren()
             
             const { slots } = storage.renderedGoods()
             
             // Simple linear distribution of slots
             const count = slots.length
             const step = length / (count + 1)
             const startX = center.x - (length / 2) * direction.dx
             const startY = center.y - (length / 2) * direction.dy

             const subCleanups: (() => void)[] = []
 
             slots.forEach((slot, i) => {
                 const t = (i + 1) * step
                 const x = startX + t * direction.dx
                 const y = startY + t * direction.dy
                 
                 // Render single slot via GoodsRenderer
                 subCleanups.push(GoodsRenderer.render(
                     this.renderer,
                     this.goodsContainer,
                     tileSize,
                     () => ({ slots: [slot], assumedMaxSlots: 1 }),
                     { x, y },
                     `border.${this.object.uid}.goods.${i}`
                 ))
             })
             
             return () => subCleanups.forEach(c => c())
         })
    }


    public dispose() {
        this.gateGraphics.destroy()
        this.goodsContainer.destroy({ children: true })
        super.dispose()
    }
}
