import { Container, Graphics, Point } from 'pixi.js'
import {
	canBuildRoadAcrossBorder,
	canBuildRoadThroughTile,
	type RoadType,
	roadBordersForTrace,
} from 'ssh/board/roads'
import type { Tile } from 'ssh/board/tile'
import { toAxialCoord, toWorldCoord } from 'ssh/utils/position'
import { tileSize } from 'ssh/utils/varied'
import { scopedPixiName, setPixiName } from '../debug-names'
import type { PixiGameRenderer } from '../renderer'
import { roadMacroStyle } from '../road-definitions'

/**
 * Zone-specific color schemes for the drag preview overlay
 */
const ZONE_COLORS: Record<string, { fill: number; stroke: number }> = {
	residential: { fill: 0x44dd66, stroke: 0x228844 }, // Green
	harvest: { fill: 0xddaa44, stroke: 0xaa7722 }, // Amber/Brown
	none: { fill: 0x888888, stroke: 0x666666 }, // Gray for unzone
	'': { fill: 0x44aaff, stroke: 0x2288dd }, // Blue (default/fallback)
}
const INVALID_ROAD_COLORS = { fill: 0xd95858, stroke: 0x9b1d24 }
/** Unified "under construction" blue footprint (shared with building ghosts). */
const CONSTRUCTION_BLUE = { fill: 0x44aaff, stroke: 0x2288dd }
/** Whole-trace invalid filigree (pinkish-red). */
const PINKISH = { fill: 0xff9a9a, stroke: 0xe0557a }

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
		const custom = parseHexColor(this.renderer.game.hex.zoneManager.findZoneByName(zoneType)?.color)
		const colors = custom
			? { fill: custom, stroke: custom }
			: ZONE_COLORS[zoneType] || ZONE_COLORS['']

		for (const tile of tiles) {
			this.drawTileHighlight(tile, colors.fill, colors.stroke, 0.3, 0.8)
		}
	}

	private showRoadPreview(tiles: Tile[], roadType: RoadType, valid: boolean) {
		this.graphics.clear()
		const style = roadMacroStyle(roadType)

		// Planned project alveoli block a road from crossing their tile; a planned
		// freight bay may terminate the road (endpoint) but never be crossed.
		const blockedKeys = new Set<string>()
		for (const project of this.renderer.game.projects.projects) {
			for (const entry of project.entries) blockedKeys.add(`${entry.coord[0]},${entry.coord[1]}`)
		}
		const plannedBlocks = (tile: Tile, isEndpoint: boolean): boolean => {
			const coord = toAxialCoord(tile.position)
			const key = `${coord.q},${coord.r}`
			if (!blockedKeys.has(key)) return false
			// A planned bay at an endpoint is a valid terminus, not a blocker.
			if (isEndpoint) {
				for (const project of this.renderer.game.projects.projects) {
					for (const entry of project.entries) {
						if (
							`${entry.coord[0]},${entry.coord[1]}` === key &&
							entry.alveolusType === 'freight_bay'
						)
							return false
					}
				}
			}
			return true
		}

		// Per-tile footprint: blue (valid) / pinkish (whole-trace invalid) / red (error).
		for (let i = 0; i < tiles.length; i++) {
			const tile = tiles[i]!
			const isEndpoint = i === 0 || i === tiles.length - 1
			const blocked =
				!canBuildRoadThroughTile(tile, undefined, isEndpoint) || plannedBlocks(tile, isEndpoint)
			const colors = blocked ? INVALID_ROAD_COLORS : valid ? CONSTRUCTION_BLUE : PINKISH
			this.drawTileHighlight(tile, colors.fill, colors.stroke, 0.36, 0.9)
		}

		// Per-border segments: a river crossing turns only that segment red; the
		// rest follow the trace validity (road color / pinkish).
		const borders = roadBordersForTrace(tiles)
		const points = tiles.map((tile) => toWorldCoord(tile.position)).filter(Boolean) as Array<{
			x: number
			y: number
		}>
		for (let i = 0; i < borders.length; i++) {
			const a = points[i]
			const b = points[i + 1]
			if (!a || !b) continue
			const river = !canBuildRoadAcrossBorder(borders[i]!)
			const color = river ? INVALID_ROAD_COLORS.stroke : valid ? style.color : PINKISH.stroke
			this.graphics.moveTo(a.x, a.y)
			this.graphics.lineTo(b.x, b.y)
			this.graphics.stroke({
				width: tileSize * 0.22,
				color,
				alpha: 0.95,
				cap: 'round',
				join: 'round',
			})
		}
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
