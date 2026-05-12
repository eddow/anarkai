import { Container, Graphics, Point } from 'pixi.js'
import { canBuildRoadThroughTile, type RoadType } from 'ssh/board/roads'
import type { Tile } from 'ssh/board/tile'
import { toWorldCoord } from 'ssh/utils/position'
import { tileSize } from 'ssh/utils/varied'
import { scopedPixiName, setPixiName } from '../debug-names'
import type { PixiGameRenderer } from '../renderer'

/**
 * Zone-specific color schemes for the drag preview overlay
 */
const ZONE_COLORS: Record<string, { fill: number; stroke: number }> = {
	residential: { fill: 0x44dd66, stroke: 0x228844 }, // Green
	harvest: { fill: 0xddaa44, stroke: 0xaa7722 }, // Amber/Brown
	none: { fill: 0x888888, stroke: 0x666666 }, // Gray for unzone
	'': { fill: 0x44aaff, stroke: 0x2288dd }, // Blue (default/fallback)
}
const ROAD_COLORS = { fill: 0x44aaff, stroke: 0x1f7fe5 }
const INVALID_ROAD_COLORS = { fill: 0xd95858, stroke: 0x9b1d24 }

function parseHexColor(color: string | undefined): number | undefined {
	if (!color) return undefined
	const parsed = Number.parseInt(color.replace(/^#/, ''), 16)
	return Number.isFinite(parsed) ? parsed : undefined
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
		const scope = 'overlay:dragPreview'
		this.container = setPixiName(new Container(), scope)
		this.graphics = setPixiName(new Graphics(), scopedPixiName(scope, 'graphics'))
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

		const onRoadPreview = (tiles: Tile[], roadType: RoadType, valid: boolean) => {
			this.showRoadPreview(tiles, roadType, valid)
		}

		const onDragPreviewClear = () => {
			this.clearPreview()
		}

		game.on({
			dragPreview: onDragPreview,
			roadPreview: onRoadPreview,
			dragPreviewClear: onDragPreviewClear,
		})

		this.cleanups.push(() => {
			game.off({
				dragPreview: onDragPreview,
				roadPreview: onRoadPreview,
				dragPreviewClear: onDragPreviewClear,
			})
		})
	}

	private showPreview(tiles: Tile[], zoneType: string) {
		this.graphics.clear()

		// Get zone-specific colors
		const custom = parseHexColor(this.renderer.game.hex.zoneManager.getZoneDefinition(zoneType)?.color)
		const colors = custom
			? { fill: custom, stroke: custom }
			: ZONE_COLORS[zoneType] || ZONE_COLORS['']

		for (const tile of tiles) {
			this.drawTileHighlight(tile, colors.fill, colors.stroke, 0.3, 0.8)
		}
	}

	private showRoadPreview(tiles: Tile[], _roadType: RoadType, valid: boolean) {
		this.graphics.clear()
		for (const tile of tiles) {
			const colors = canBuildRoadThroughTile(tile) ? ROAD_COLORS : INVALID_ROAD_COLORS
			this.drawTileHighlight(tile, colors.fill, colors.stroke, 0.36, 0.9)
		}
		const points = tiles.map((tile) => toWorldCoord(tile.position)).filter(Boolean) as Array<{
			x: number
			y: number
		}>
		if (points.length < 2) return
		this.graphics.moveTo(points[0]!.x, points[0]!.y)
		const end = points[points.length - 1]!
		this.graphics.lineTo(end.x, end.y)
		this.graphics.stroke({
			width: tileSize * 0.22,
			color: valid ? ROAD_COLORS.stroke : INVALID_ROAD_COLORS.stroke,
			alpha: 0.95,
			cap: 'round',
			join: 'round',
		})
	}

	private drawTileHighlight(
		tile: Tile,
		fill: number,
		stroke: number,
		fillAlpha = 0.26,
		strokeAlpha = 0.78
	) {
		const worldPos = toWorldCoord(tile.position)
		if (!worldPos) return
		const points = Array.from({ length: 6 }, (_, i) => {
			const angle = (Math.PI / 3) * (i + 0.5)
			return new Point(
				worldPos.x + Math.cos(angle) * (tileSize - 2),
				worldPos.y + Math.sin(angle) * (tileSize - 2)
			)
		})
		this.graphics.poly(points).fill({ color: fill, alpha: fillAlpha })
		this.graphics.poly(points).stroke({ width: 2, color: stroke, alpha: strokeAlpha })
	}

	private clearPreview() {
		this.graphics.clear()
	}

	public dispose() {
		this.cleanups.forEach((c) => c())
		this.container.destroy({ children: true })
	}
}
