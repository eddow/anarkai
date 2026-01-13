import { Container, Graphics, Point } from 'pixi.js'
import { tileSize } from 'ssh/src/lib/utils/varied'
import { toWorldCoord } from 'ssh/src/lib/utils/position'
import type { Tile } from 'ssh/src/lib/game/board/tile'
import type { PixiGameRenderer } from '../renderer'

/**
 * Zone-specific color schemes for the drag preview overlay
 */
const ZONE_COLORS: Record<string, { fill: number; stroke: number }> = {
    residential: { fill: 0x44dd66, stroke: 0x228844 },  // Green
    harvest: { fill: 0xddaa44, stroke: 0xaa7722 },      // Amber/Brown
    none: { fill: 0x888888, stroke: 0x666666 },         // Gray for unzone
    '': { fill: 0x44aaff, stroke: 0x2288dd },           // Blue (default/fallback)
}

/**
 * Renders a visual overlay when dragging to select tiles for zoning.
 * This is a screen-space overlay that shows which tiles will be selected.
 */
export class DragPreviewOverlay {
    private container: Container
    private graphics: Graphics
    private cleanups: (() => void)[] = []

    constructor(private renderer: PixiGameRenderer) {
        this.container = new Container()
        this.graphics = new Graphics()
        this.container.addChild(this.graphics)
        
        // Add to the UI layer (above game content but follows world transform)
        // Actually, we want it in world space so it moves with the camera
        this.renderer.world?.addChild(this.container)
        this.container.zIndex = 100 // Above everything else
    }

    public bind() {
        const game = this.renderer.game

        // Listen for drag preview events
        const onDragPreview = (tiles: Tile[], zoneType: string) => {
            this.showPreview(tiles, zoneType)
        }

        const onDragPreviewClear = () => {
            this.clearPreview()
        }

        game.on({ dragPreview: onDragPreview, dragPreviewClear: onDragPreviewClear })

        this.cleanups.push(() => {
            game.off({ dragPreview: onDragPreview, dragPreviewClear: onDragPreviewClear })
        })
    }

    private showPreview(tiles: Tile[], zoneType: string) {
        this.graphics.clear()

        // Get zone-specific colors
        const colors = ZONE_COLORS[zoneType] || ZONE_COLORS['']

        for (const tile of tiles) {
            const worldPos = toWorldCoord(tile.position)
            if (!worldPos) continue

            // Draw a hex outline for each tile in the selection
            const points = Array.from({ length: 6 }, (_, i) => {
                const angle = (Math.PI / 3) * (i + 0.5)
                return new Point(
                    worldPos.x + Math.cos(angle) * (tileSize - 2),
                    worldPos.y + Math.sin(angle) * (tileSize - 2)
                )
            })

            // Fill with semi-transparent zone color
            this.graphics.poly(points).fill({ color: colors.fill, alpha: 0.3 })
            // Stroke with solid border
            this.graphics.poly(points).stroke({ width: 2, color: colors.stroke, alpha: 0.8 })
        }
    }

    private clearPreview() {
        this.graphics.clear()
    }

    public dispose() {
        this.cleanups.forEach(c => c())
        this.container.destroy({ children: true })
    }
}
