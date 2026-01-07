import type { ScopedCallback } from 'mutts'
import { Graphics } from 'pixi.js'
import { renderBorderGoods } from '$lib/game/storage/goods-renderer'
import { SlottedStorage } from '$lib/game/storage/slotted-storage'
import { tileSize } from '$lib/utils'
import { toAxialCoord, toWorldCoord } from '$lib/utils/position'
import type { Alveolus } from '../content/alveolus'
import { type TileBorder, TileBorderContent } from './border'

// A storage gate placed on a border between two tiles/alveoli.
export class AlveolusGate extends TileBorderContent {
	readonly storage: SlottedStorage

	get alveolusA() {
		return this.border.tile.a.content as Alveolus
	}
	get alveolusB() {
		return this.border.tile.b.content as Alveolus
	}

	get hive() {
		return this.alveolusA!.hive
	}

	readonly debugInfo = {
		type: 'AlveolusGate',
		storage: 'SlottedStorage',
	}

	constructor(readonly border: TileBorder) {
		const axialPos = toAxialCoord(border.position)
		super(border.game, `gate:${axialPos.q},${axialPos.r}`)
		this.storage = new SlottedStorage(2, 1) // 2 slots, max quantity 1 per slot
	}

	attach(): void {
		this.border.content = this
	}

	// Remove the gate if not exactly two alveoli are connected.
	validateOrRemove(): void {
		if (!this.alveolusA || !this.alveolusB) {
			this.border.content = undefined
		}
	}

	render(): ScopedCallback | undefined {
		// Get world coordinates of both tiles
		const tileAWorld = toWorldCoord(this.border.tile.a.position)
		const tileBWorld = toWorldCoord(this.border.tile.b.position)

		// Calculate border center position
		const borderCenter = {
			x: (tileAWorld.x + tileBWorld.x) / 2,
			y: (tileAWorld.y + tileBWorld.y) / 2,
		}

		// Calculate relative position of tile A from the border center
		const alveolusCenter = {
			x: tileAWorld.x - borderCenter.x,
			y: tileAWorld.y - borderCenter.y,
		}

		// Create a container for both the line and the goods
		const root = this.game.storedGoodsLayer
		const lineGraphics = new Graphics()
		root.addChild(lineGraphics)

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
		const lineLength = tileSize * 0.8 // Scale by size like in renderBorderGoods
		const startPos = {
			x: borderCenter.x - (lineLength / 2) * normalizedBorder.dx,
			y: borderCenter.y - (lineLength / 2) * normalizedBorder.dy,
		}
		const endPos = {
			x: borderCenter.x + (lineLength / 2) * normalizedBorder.dx,
			y: borderCenter.y + (lineLength / 2) * normalizedBorder.dy,
		}

		// Draw the yellow line
		lineGraphics
			.moveTo(startPos.x, startPos.y)
			.lineTo(endPos.x, endPos.y)
			.stroke({ color: 0xffff00, width: 2, alpha: 0.7 })

		// Render border goods using the storage
		const goodsCleanup = renderBorderGoods(
			this.game,
			tileSize,
			() => this.storage.renderedGoods(),
			borderCenter,
			alveolusCenter,
		)

		// Return cleanup function that removes both the line and goods
		return () => {
			goodsCleanup?.()
			root.removeChild(lineGraphics)
			lineGraphics.destroy()
		}
	}
}
