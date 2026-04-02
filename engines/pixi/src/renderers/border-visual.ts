import { effect } from 'mutts'
import { Container, Graphics } from 'pixi.js'
import { AlveolusGate } from 'ssh/board/border/alveolus-gate'
import type { TileBorder } from 'ssh/board/border/border'
import { toWorldCoord } from 'ssh/utils/position'
import { tileSize } from 'ssh/utils/varied'
import { scopedPixiName, setPixiName } from '../debug-names'
import type { PixiGameRenderer } from '../renderer'
import { renderGoods } from './goods-renderer'
import { VisualObject } from './visual-object'

export class BorderVisual extends VisualObject<TileBorder> {
	private gateGraphics: Graphics
	private goodsContainer: Container

	constructor(border: TileBorder, renderer: PixiGameRenderer) {
		super(border, renderer)
		const scope = `border:${border.uid}`
		this.view.label = scope
		this.gateGraphics = setPixiName(new Graphics(), scopedPixiName(scope, 'gate'))
		this.goodsContainer = setPixiName(new Container(), scopedPixiName(scope, 'goods'))

		// Borders are rendered on storedGoods layer usually (for gates) or ground layer?
		// Gates are "connections" between alveoli.
		// Let's use alveoli layer for the structure/line, storedGoods for goods.

		this.renderer.layers.alveoli.addChild(this.gateGraphics)
		this.renderer.layers.storedGoods.addChild(this.goodsContainer)
	}

	public bind() {
		const worldPos = toWorldCoord(this.object.position) // Border position is mid-point

		this.register(
			effect`border.${this.object.uid}.render`(() => {
				this.gateGraphics.clear()
				this.goodsContainer.removeChildren()

				const content = this.object.content

				if (content instanceof AlveolusGate) {
					return this.renderGate(content, worldPos)
				}
			})
		)
	}

	private renderGate(gate: AlveolusGate, center: { x: number; y: number }) {
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
		center: { x: number; y: number },
		direction: { dx: number; dy: number },
		length: number
	) {
		// Storage access
		const storage = gate.storage
		if (!storage) return

		return effect`border.${this.object.uid}.goods`(() => {
			this.goodsContainer.removeChildren()

			const { slots } = storage.renderedGoods()
			const positions = getBorderGoodsPositions(center, direction, length, slots.length)

			const subCleanups: (() => void)[] = []

			slots.forEach((slot, i) => {
				const position = positions[i]
				if (!position) return

				// Render single slot via GoodsRenderer
				subCleanups.push(
					renderGoods(
						this.renderer,
						this.goodsContainer,
						tileSize,
						() => ({ slots: [slot], assumedMaxSlots: 1 }),
						position,
						`border.${this.object.uid}.goods.${i}`
					)
				)
			})

			return () => subCleanups.forEach((c) => c())
		})
	}

	public dispose() {
		this.gateGraphics.destroy()
		this.goodsContainer.destroy({ children: true })
		super.dispose()
	}
}

export function getBorderGoodsPositions(
	center: { x: number; y: number },
	direction: { dx: number; dy: number },
	length: number,
	count: number
) {
	if (count === 0) return []
	const magnitude = Math.hypot(direction.dx, direction.dy)
	if (magnitude === 0) return Array.from({ length: count }, () => ({ ...center }))
	const normalizedDirection = {
		dx: direction.dx / magnitude,
		dy: direction.dy / magnitude,
	}
	const step = length / (count + 1)
	const startX = center.x - (length / 2) * normalizedDirection.dx
	const startY = center.y - (length / 2) * normalizedDirection.dy
	return Array.from({ length: count }, (_, i) => {
		const t = (i + 1) * step
		return {
			x: startX + t * normalizedDirection.dx,
			y: startY + t * normalizedDirection.dy,
		}
	})
}
