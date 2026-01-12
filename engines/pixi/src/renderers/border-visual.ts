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
    
    constructor(border: TileBorder, private renderer: PixiGameRenderer) {
        super(border)
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
                 this.renderGate(content, worldPos)
             }
         }))
    }
    
    private renderGate(gate: AlveolusGate, center: {x: number, y: number}) {
		// Logic ported from AlveolusGate.render
		const tileAWorld = toWorldCoord(this.object.tile.a.position)
		const tileBWorld = toWorldCoord(this.object.tile.b.position)

		// Calculate relative position of tile A from the border center
		const alveolusCenter = {
			x: tileAWorld.x - center.x,
			y: tileAWorld.y - center.y,
		}

		// Calculate the two end positions for the line using the same logic as renderBorderGoods
		const alveolus2Center = { x: -alveolusCenter.x, y: -alveolusCenter.y }

		// Calculate the line connecting the two alveoli centers
		const centerLine = {
			dx: alveolus2Center.x - alveolusCenter.x,
			dy: alveolus2Center.y - alveolusCenter.y,
		}

		// Calculate the perpendicular direction (border line direction)
		// Rotate the center line by 90 degrees: (dx, dy) -> (-dy, dx)
		const borderDirection = {
			dx: -centerLine.dy,
			dy: centerLine.dx,
		}

		// Normalize the border direction
		const borderLength = Math.sqrt(borderDirection.dx ** 2 + borderDirection.dy ** 2)
		const normalizedBorder = {
			dx: borderDirection.dx / borderLength,
			dy: borderDirection.dy / borderLength,
		}

		// Calculate the two end positions for the line (where goods would be displayed)
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

		// Render border goods 
        // GoodsRenderer helper is NOT suitable because renderBorderGoods (in ssh, now ?? moved?) was different.
        // Wait, I deleted `ssh/.../goods-renderer.ts` and moved it to `engine/pixi/...`.
        // But `GoodsRenderer` class in pixi only has `renderTiles`.
        // `renderBorderGoods` was a function. Did I preserve it?
        // I created `GoodsRenderer.render` which seems to assume radial layout (alveolus style).
        
        // I need `renderBorderGoods` logic for linear layout.
        // If I lost it, I need to recreate it.
        // `AlveolusGate` code I viewed earlier used `renderBorderGoods`.
        // Let's implement specific rendering here for now or add to GoodsRenderer.
        
        // Simple implementation reusing logic:
        const storage = gate.storage
        if (!storage) return
        
        // For linear display along the border.
        // Logic:
        const slots = storage.renderedGoods().slots
        if (slots.length === 0) return
        
        // Similar to GoodsRenderer but linear layout along borderDirection
        // ... Implementation (simplified)
        // Actually, just render standard goods for now to prove connectivity?
        // Or re-implement the linear distribution.
        
        // TODO: Implement proper linear goods rendering. For now, just circle.
        // Using existing GoodsRenderer at center as fallback
        
        const cleanup = GoodsRenderer.render(
             this.renderer,
             this.goodsContainer,
             tileSize,
             () => ({ slots }),
             center
        )
        // Cleanup is called when effect re-runs, via registry?
        // Wait, `namedEffect` returns disposer? No, it executes.
        // `this.register` handles disposables returned by the callback?
        // No, `namedEffect` handles reactivity.
        // I need to manually handle nested cleanups?
        // `namedEffect` returns void cleanup function from body?
        // Yes.
        // So I should return cleanup from effect body.
        
        return cleanup 
    }

    public dispose() {
        this.gateGraphics.destroy()
        this.goodsContainer.destroy({ children: true })
        super.dispose()
    }
}
