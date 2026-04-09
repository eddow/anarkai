import { effect } from 'mutts'
import { Container, Graphics } from 'pixi.js'
import type { TileBorder } from 'ssh/board/border/border'
import type { RenderedGoodSlot } from 'ssh/storage/types'
import { toWorldCoord } from 'ssh/utils/position'
import { tileSize } from 'ssh/utils/varied'
import { scopedPixiName, setPixiName } from '../debug-names'
import type { PixiGameRenderer } from '../renderer'
import { renderGoods } from './goods-renderer'
import { VisualObject } from './visual-object'

type GateLike = {
	storage?: {
		renderedGoods(): {
			slots: RenderedGoodSlot[]
		}
	}
}

function isGateLike(value: unknown): value is GateLike {
	return !!value && typeof value === 'object' && 'storage' in value
}

export class BorderVisual extends VisualObject<TileBorder> {
	private gateGraphics: Graphics
	private goodsContainer: Container

	constructor(border: TileBorder, renderer: PixiGameRenderer) {
		super(border, renderer)
		const scope = `border:${border.uid}`
		this.view.label = scope
		this.gateGraphics = setPixiName(new Graphics(), scopedPixiName(scope, 'gate'))
		this.goodsContainer = setPixiName(new Container(), scopedPixiName(scope, 'goods'))
		this.gateGraphics.eventMode = 'none'
		this.goodsContainer.eventMode = 'none'
		this.view.addChild(this.gateGraphics, this.goodsContainer)
	}

	public bind() {
		const worldPos = toWorldCoord(this.object.position) // Border position is mid-point
		this.view.position.set(worldPos.x, worldPos.y)
		this.view.zIndex = worldPos.y
		this.goodsContainer.zIndex = worldPos.y
		this.renderer.attachToLayer(this.renderer.layers.storedGoods, this.goodsContainer)

		this.register(
			effect`border.${this.object.uid}.render`(() => {
				this.gateGraphics.clear()
				this.goodsContainer.removeChildren()

				const content = this.object.content

				if (isGateLike(content)) {
					return this.renderGate(content, worldPos)
				}
			})
		)
	}

	private renderGate(gate: GateLike, centerWorld: { x: number; y: number }) {
		const tileAWorld = toWorldCoord(this.object.tile.a.position)
		const alveolusCenter = {
			x: tileAWorld.x - centerWorld.x,
			y: tileAWorld.y - centerWorld.y,
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

		return this.renderBorderGoods(gate, { x: 0, y: 0 }, borderDirection, tileSize * 0.8)
	}

	private renderBorderGoods(
		gate: GateLike,
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
		if (this.renderer.layers?.ground) {
			this.renderer.detachFromLayer(this.renderer.layers.ground, this.view)
		}
		if (this.renderer.layers?.storedGoods) {
			this.renderer.detachFromLayer(this.renderer.layers.storedGoods, this.goodsContainer)
		}
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
