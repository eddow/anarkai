import type { ScopedCallback } from 'mutts'
import { ColorMatrixFilter, Container, Graphics, Sprite } from 'pixi.js'
import { goods as goodsCatalog } from '$assets/game-content'
import { namedEffect } from '$lib/debug'
import type { GoodType } from '$lib/types/base'

export interface RenderedGoodSlot {
	goodType: GoodType
	present: number
	reserved: number
	allocated: number
	allowed: number
}
export interface RenderedGoodSlots {
	slots: RenderedGoodSlot[]
	assumedMaxSlots?: number
}
/**
 * Renders goods based on the provided slots, similar to slotted storage but with one slot per good type.
 * Each good type gets its own "slot" and can show different visual states.
 * @param game - The game instance
 * @param size - The size of the tile
 * @param getSlots - Function that returns the slots to render
 * @param worldPosition - Absolute world position for the container
 * @returns A cleanup function
 */
export function renderTileGoods(
	game: any,
	size: number,
	getSlots: () => RenderedGoodSlots,
	worldPosition: { x: number; y: number },
	targetContainer?: Container,
): ScopedCallback | undefined {
	const root = new Container()
	root.position.set(worldPosition.x, worldPosition.y)
	const container = targetContainer ?? game.storedGoodsLayer
	container.addChild(root)

	const effectCleanup = namedEffect('tile.storage.render', () => {
		const sprites: (Sprite | Graphics)[] = []
		const { slots, assumedMaxSlots } = getSlots()

		if (slots.length === 0) {
			return
		}

		const n = assumedMaxSlots ?? slots.length
		const [centerIndex, around] = n === 1 || n === 5 ? [0, n - 1] : [-1, n]

		// Calculate layout
		const radius = size * 0.4
		const spriteSize = size * 0.5

		for (let i = 0; i < slots.length; i++) {
			const slot = slots[i]
			const goodDef = goodsCatalog[slot.goodType]
			if (!goodDef) continue

			// Calculate position for this slot
			let [x, y] = [0, 0]
			if (centerIndex !== i) {
				const angle = (i * 2 * Math.PI) / around
				x = Math.cos(angle) * radius
				y = Math.sin(angle) * radius
			}
			const texture = game.getTexture(goodDef.sprites[0])
			const scale = spriteSize / texture.height
			const dy = spriteSize / 4
			const totalHeight = (slot.allowed + 1) * dy
			const presentOffset = dy - totalHeight / 2
			// Draw blueish gauge indicating max height (-H/2 to +H/2)
			const gaugeWidth = spriteSize * 0.6
			const gauge = new Graphics()
			gauge
				.rect(x - gaugeWidth / 2, y - totalHeight / 2, gaugeWidth, totalHeight)
				.fill({ color: 0x000080, alpha: 0.5 })
			root.addChild(gauge)
			sprites.push(gauge)

			// Render present goods (normal colors) - one sprite per quantity
			for (let q = 0; q < slot.present; q++) {
				const sprite = new Sprite(texture)
				sprite.scale.set(scale)
				sprite.anchor.set(0.5)
				sprite.position.set(x, y - q * dy - presentOffset)
				root.addChild(sprite)
				sprites.push(sprite)
			}
			const reservedOffset = presentOffset + slot.present * dy
			// Render reserved goods (reddish tint) - one sprite per reserved quantity
			for (let r = 0; r < slot.reserved; r++) {
				const sprite = new Sprite(texture)
				sprite.scale.set(scale)
				sprite.anchor.set(0.5)
				// Apply reddish tint
				sprite.tint = 0xff6666 // Light red tint
				sprite.alpha = 0.7
				sprite.position.set(x, y - r * dy - reservedOffset)
				root.addChild(sprite)
				sprites.push(sprite)
			}

			const allocatedOffset = reservedOffset + slot.reserved * dy
			// Render allocated goods (black & white) - one sprite per allocated quantity
			for (let a = 0; a < slot.allocated; a++) {
				const sprite = new Sprite(texture)
				sprite.scale.set(scale)
				sprite.anchor.set(0.5)
				// Apply grayscale filter (black & white)
				const grayscaleFilter = new ColorMatrixFilter()
				grayscaleFilter.desaturate()
				sprite.alpha = 0.5
				sprite.filters = [grayscaleFilter]
				sprite.position.set(x, y - a * dy - allocatedOffset)
				root.addChild(sprite)
				sprites.push(sprite)
			}
		}

		return () => {
			for (const s of sprites) s.destroy()
		}
	})

	return () => {
		effectCleanup?.()
		container.removeChild(root)
		root.destroy({ children: false })
	}
}

/**
 * Renders goods on a border between two alveoli.
 * Takes the relative center of one alveolus and calculates positions along the border line.
 * Goods are distributed along the line while avoiding corners.
 * @param game - The game instance
 * @param size - The size of the tile
 * @param getSlots - Function that returns the slots to render
 * @param borderWorldPosition - Absolute world position of the border center
 * @param alveolusCenter - Relative position of one alveolus from border center
 * @returns A cleanup function
 */
export function renderBorderGoods(
	game: any,
	size: number,
	getSlots: () => RenderedGoodSlots,
	borderWorldPosition: { x: number; y: number },
	alveolusCenter: { x: number; y: number },
): ScopedCallback | undefined {
	const root = new Container()
	root.position.set(borderWorldPosition.x, borderWorldPosition.y)
	game.storedGoodsLayer.addChild(root)

	const effectCleanup = namedEffect('border.storage.render', () => {
		const sprites: (Sprite | Graphics)[] = []
		const { slots, assumedMaxSlots } = getSlots()

		if (slots.length === 0) {
			return
		}

		const n = assumedMaxSlots ?? slots.length

		// Calculate the second alveolus center (opposite position)
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

		// Calculate the midpoint of the border line
		const borderMidpoint = {
			x: (alveolusCenter.x + alveolus2Center.x) / 2,
			y: (alveolusCenter.y + alveolus2Center.y) / 2,
		}

		// Calculate positions along the border line
		const positions: { x: number; y: number }[] = []

		// n slots at 1/(n+1), 2/(n+1), ..., n/(n+1)
		for (let i = 1; i <= n; i++) {
			const t = (i - (n + 1) / 2) / (n + 1) // Center around 0, then scale
			positions.push({
				x: borderMidpoint.x + t * normalizedBorder.dx * size, // * 0.8, // Scale by size
				y: borderMidpoint.y + t * normalizedBorder.dy * size, // * 0.8,
			})
		}

		// Calculate sprite properties
		const spriteSize = size * 0.5
		const dy = spriteSize / 4

		for (let i = 0; i < slots.length && i < positions.length; i++) {
			const slot = slots[i]
			const goodDef = goodsCatalog[slot.goodType]
			if (!goodDef) continue

			const pos = positions[i]
			const texture = game.getTexture(goodDef.sprites[0])
			const scale = spriteSize / texture.height
			const totalHeight = (slot.allowed + 1) * dy
			const presentOffset = dy - totalHeight / 2

			// Draw blueish gauge indicating max height
			const gaugeWidth = spriteSize * 0.6
			const gauge = new Graphics()
			gauge
				.rect(pos.x - gaugeWidth / 2, pos.y - totalHeight / 2, gaugeWidth, totalHeight)
				.fill({ color: 0x000080, alpha: 0.5 })
			root.addChild(gauge)
			sprites.push(gauge)

			// Render present goods (normal colors) - one sprite per quantity
			for (let q = 0; q < slot.present; q++) {
				const sprite = new Sprite(texture)
				sprite.scale.set(scale)
				sprite.anchor.set(0.5)
				sprite.position.set(pos.x, pos.y - q * dy - presentOffset)
				root.addChild(sprite)
				sprites.push(sprite)
			}

			const reservedOffset = presentOffset + slot.present * dy
			// Render reserved goods (reddish tint) - one sprite per reserved quantity
			for (let r = 0; r < slot.reserved; r++) {
				const sprite = new Sprite(texture)
				sprite.scale.set(scale)
				sprite.anchor.set(0.5)
				// Apply reddish tint
				sprite.tint = 0xff6666 // Light red tint
				sprite.alpha = 0.7
				sprite.position.set(pos.x, pos.y - r * dy - reservedOffset)
				root.addChild(sprite)
				sprites.push(sprite)
			}

			const allocatedOffset = reservedOffset + slot.reserved * dy
			// Render allocated goods (black & white) - one sprite per allocated quantity
			for (let a = 0; a < slot.allocated; a++) {
				const sprite = new Sprite(texture)
				sprite.scale.set(scale)
				sprite.anchor.set(0.5)
				// Apply grayscale filter (black & white)
				const grayscaleFilter = new ColorMatrixFilter()
				grayscaleFilter.desaturate()
				sprite.alpha = 0.5
				sprite.filters = [grayscaleFilter]
				sprite.position.set(pos.x, pos.y - a * dy - allocatedOffset)
				root.addChild(sprite)
				sprites.push(sprite)
			}
		}

		return () => {
			for (const s of sprites) s.destroy()
		}
	})

	return () => {
		effectCleanup?.()
		game.storedGoodsLayer.removeChild(root)
		root.destroy({ children: false })
	}
}
