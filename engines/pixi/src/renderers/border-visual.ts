import { effect } from 'mutts'
import { Container } from 'pixi.js'
import type { TileBorder } from 'ssh/board/border/border'
import type { RenderedGoodSlot } from 'ssh/storage/types'
import type { GoodType } from 'ssh/types'
import { toAxialCoord, toWorldCoord } from 'ssh/utils/position'
import { tileSize } from 'ssh/utils/varied'
import { scopedPixiName, setPixiName } from '../debug-names'
import type { PixiGameRenderer } from '../renderer'
import { createGoodsRenderer, type GoodsRenderer } from './goods-renderer'
import { VisualObject } from './visual-object'

type GateLike = {
	uid?: string
	storage?: {
		renderedGoods(): {
			slots: RenderedGoodSlot[]
		}
	}
	hive?: {
		movingGoods?: {
			get(coord: {
				q: number
				r: number
			}): Array<{ goodType: GoodType; claimed?: boolean }> | undefined
		}
	}
}

function isGateLike(value: unknown): value is GateLike {
	return !!value && typeof value === 'object' && 'storage' in value
}

export function visibleBorderGateSlots(
	slots: RenderedGoodSlot[],
	hiddenReservedGoods: Partial<Record<GoodType, number>> = {}
): RenderedGoodSlot[] {
	return slots.map((slot) => {
		if (slot.present || slot.allocated || !slot.reserved || !slot.goodType) return slot
		const hidden = hiddenReservedGoods[slot.goodType] ?? 0
		if (hidden <= 0) return slot
		hiddenReservedGoods[slot.goodType] = hidden - 1
		return { present: 0, reserved: 0, allocated: 0, allowed: slot.allowed }
	})
}

export class BorderVisual extends VisualObject<TileBorder> {
	private readonly goodsContainer: Container
	private readonly scope: string
	private gateGoodsRenderers: GoodsRenderer[] = []

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
					this.clearGateGoods()
					return
				}
				this.renderGate(content)
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

		this.clearGateGoods()
		const storage = gate.storage
		if (!storage) return

		const { slots } = storage.renderedGoods()
		const visibleSlots = visibleBorderGateSlots(slots, this.claimedGoodsAtBorder(gate))
		const positions = getBorderGoodsPositions(
			{ x: 0, y: 0 },
			borderDirection,
			tileSize * 0.8,
			visibleSlots.length
		)
		this.gateGoodsRenderers = visibleSlots.flatMap((slot, i) => {
			const position = positions[i]
			if (!position) return []
			const renderer = createGoodsRenderer(
				this.renderer,
				this.goodsContainer,
				tileSize,
				() => ({ slots: [slot], assumedMaxSlots: 1 }),
				position,
				`${this.scope}.goods.${i}`
			)
			renderer.render()
			return [renderer]
		})
	}

	private claimedGoodsAtBorder(gate: GateLike): Partial<Record<GoodType, number>> {
		const coord = toAxialCoord(this.object.position)
		const movements = coord ? gate.hive?.movingGoods?.get(coord) : undefined
		const claimed: Partial<Record<GoodType, number>> = {}
		for (const movement of movements ?? []) {
			if (!movement.claimed) continue
			claimed[movement.goodType] = (claimed[movement.goodType] ?? 0) + 1
		}
		return claimed
	}

	public refreshStoredGoods() {
		const content = this.object.content
		if (!isGateLike(content)) {
			this.clearGateGoods()
			return
		}
		this.renderGate(content)
	}

	private clearGateGoods() {
		this.gateGoodsRenderers.forEach((renderer) => renderer.dispose())
		this.gateGoodsRenderers = []
		this.goodsContainer.removeChildren().forEach((c) => c.destroy())
	}

	public dispose() {
		if (this.renderer.layers?.storedGoods) {
			this.renderer.detachFromLayer(this.renderer.layers.storedGoods, this.view)
		}
		this.clearGateGoods()
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
