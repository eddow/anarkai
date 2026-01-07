import type { ScopedCallback } from 'mutts'
import { ColorMatrixFilter, Container, Graphics, Point, TilingSprite } from 'pixi.js'
import { namedEffect } from '$lib/debug'
import { GameObject, withGenerator } from '$lib/game/object'
import { interactionMode, mrg } from '$lib/globals'
import { tileSize } from '$lib/utils'
import { toWorldCoord } from '$lib/utils/position'
import type { Storage } from '../../storage'
import type { Tile } from '../tile'

export abstract class TileContent extends withGenerator(GameObject) {
	abstract readonly tile: Tile
	// TODO: translate-> name = translation set on load
	abstract readonly name?: string
	abstract readonly debugInfo: Record<string, any>
	abstract readonly walkTime: number
	abstract readonly background: string
	// Optional storage - undefined for tiles that don't store goods
	abstract storage?: Storage
	/**
	 * Render the tile content including both background and content
	 * @returns A cleanup function to be called when the content is removed
	 */
	abstract render(): ScopedCallback | undefined
	/**
	 * Check if this tile content can perform the given action
	 * @param action - The action to check
	 * @returns true if the action can be performed
	 */
	abstract canInteract?(action: string): boolean

	/**
	 * Get color code for this tile content based on zone or other status
	 * @returns Object with tint and optional borderColor
	 */
	colorCode(): { tint: number; borderColor?: number } {
		// Base colors based on zone
		if (this.tile.zone === 'residential') {
			return { tint: 0xaaffaa, borderColor: 0x44dd44 } // greenish tint, strong green border
		} else if (this.tile.zone === 'harvest') {
			return { tint: 0xccaa88, borderColor: 0xaa7744 } // brownish tint, strong brown border
		}
		return { tint: 0xffffff } // default white (no tint)
	}

	/**
	 * Helper to render tile background (hexagonal sprite)
	 * Should be called by subclasses in their render() method
	 */
	protected renderBackground(): ScopedCallback {
		const { position } = this.tile
		const { x: wpx, y: wpy } = toWorldCoord(position)

		const tileContainer = new Container()
		tileContainer.position.set(wpx, wpy)

		const size = tileSize
		const texture = this.game.getTexture(this.background)
		const tileSprite = new TilingSprite({ texture, width: size * 2, height: size * 2 })
		tileSprite.anchor.set(0.5)
		tileSprite.tilePosition.set(-wpx % (texture.width || size), -wpy % (texture.height || size))

		const mask = new Graphics()
		const points = Array.from({ length: 6 }, (_, i) => {
			const angle = (Math.PI / 3) * (i + 0.5)
			return new Point(Math.cos(angle) * size, Math.sin(angle) * size)
		})
		mask.poly(points).fill(0xffffff)
		tileSprite.mask = mask
		const brightnessFilter = new ColorMatrixFilter()
		tileSprite.filters = [brightnessFilter]

		tileContainer.addChild(tileSprite, mask)
		this.game.groundLayer.addChild(tileContainer)

		// Zone border graphics (created once, updated reactively)
		const zoneBorder = new Graphics()
		tileContainer.addChild(zoneBorder)

		const mouseoverEffect = namedEffect('tile.mouseover', () => {
			let brightness = 1

			// Get base color code from content
			const colorCode = this.colorCode()
			let tint = colorCode.tint

			// Overlay: show action preview on hover
			if (mrg.hoveredObject === this.tile) {
				const action = interactionMode.selectedAction
				// Check if this tile can interact with the selected action
				if (action && this.canInteract?.(action)) {
					if (action.startsWith('zone:')) {
						const zoneType = action.replace('zone:', '')
						if (zoneType === 'residential') {
							tint = 0x88ff88 // brighter greenish for zone preview
							brightness = 1.1
						} else if (zoneType === 'harvest') {
							tint = 0xddbb99 // brighter brownish for zone preview
							brightness = 1.1
						} else if (zoneType === 'none') {
							tint = 0xbbbbbb // grey-ish for unzone preview
							brightness = 1.1
						}
					} else {
						// Default hover for other actions (builds, etc.)
						tint = 0xaaaaff
						brightness = 1.2
					}
				} else if (!action || action === '' || action === 'select') {
					// Default hover in selection mode
					tint = 0xaaaaff
					brightness = 1.2
				}
			}

			tileSprite.tint = tint
			brightnessFilter.brightness(brightness, false)

			// Draw border if color code provides one
			zoneBorder.clear()
			if (colorCode.borderColor) {
				const borderWidth = 3
				// Draw polygon slightly smaller so the stroke extends only inward (inner half of border)
				const innerSize = size - borderWidth / 4
				const points = Array.from({ length: 6 }, (_, i) => {
					const angle = (Math.PI / 3) * (i + 0.5)
					return new Point(Math.cos(angle) * innerSize, Math.sin(angle) * innerSize)
				})
				zoneBorder.poly(points).stroke({ width: borderWidth / 2, color: colorCode.borderColor })
			}
		})

		return () => {
			mouseoverEffect()
			tileContainer.destroy({ children: false })
			this.game.groundLayer.removeChild(tileContainer)
		}
	}
}
