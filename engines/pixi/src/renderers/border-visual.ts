import { effect } from 'mutts'
import { Container } from 'pixi.js'
import type { TileBorder } from 'ssh/board/border/border'
import type { RenderedGoodSlot } from 'ssh/storage/types'
import { toWorldCoord } from 'ssh/utils/position'
import { tileSize } from 'ssh/utils/varied'
import { scopedPixiName, setPixiName } from '../debug-names'
import type { PixiGameRenderer } from '../renderer'
import { renderGoods } from './goods-renderer'
import { VisualObject } from './visual-object'

type GateLike = {
	uid?: string
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
	private readonly goodsContainer: Container
	private readonly scope: string

	constructor(border: TileBorder, renderer: PixiGameRenderer) {
		super(border, renderer)
		this.scope = `border:${border.uid}`
		this.view.label = this.scope
		this.view.eventMode = 'none'
		this.goodsContainer = setPixiName(new Container(), scopedPixiName(this.scope, 'goods'))
		this.goodsContainer.eventMode = 'none'
		this.view.addChild(this.goodsContainer)
	}

	public bind() {
		const worldPos = toWorldCoord(this.object.position)
		this.view.position.set(worldPos.x, worldPos.y)
		this.view.zIndex = worldPos.y
		this.goodsContainer.zIndex = worldPos.y
		this.renderer.attachToLayer(this.renderer.layers.storedGoods, this.view)

		this.register(
			effect`${this.scope}.render`(() => {
				const content = this.object.content
				if (!isGateLike(content)) {
					this.goodsContainer.removeChildren().forEach((c) => c.destroy())
					return
				}
				return this.renderGate(content)
			})
		)
	}

	private renderGate(gate: GateLike) {
		const centerWorld = toWorldCoord(this.object.position)
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

		return effect`${this.scope}.gate.${gate.uid ?? 'anonymous'}`(() => {
			const storage = gate.storage
			if (!storage) {
				this.goodsContainer.removeChildren().forEach((c) => c.destroy())
				return
			}

			this.goodsContainer.removeChildren().forEach((c) => c.destroy())
			const { slots } = storage.renderedGoods()
			const positions = getBorderGoodsPositions({ x: 0, y: 0 }, borderDirection, tileSize * 0.8, slots.length)
			const cleanups = slots.map((slot, i) => {
				const position = positions[i]
				if (!position) return undefined
				return renderGoods(
					this.renderer,
					this.goodsContainer,
					tileSize,
					() => ({ slots: [slot], assumedMaxSlots: 1 }),
					position,
					`${this.scope}.goods.${i}`
				)
			})

			return () => cleanups.forEach((cleanup) => cleanup?.())
		})
	}

	public dispose() {
		if (this.renderer.layers?.storedGoods) {
			this.renderer.detachFromLayer(this.renderer.layers.storedGoods, this.view)
		}
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
