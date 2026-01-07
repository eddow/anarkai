import { atomic, reactive, type ScopedCallback, unreactive } from 'mutts'
import { Container, Sprite } from 'pixi.js'
import { goods } from '$assets/game-content'
import { assert, namedEffect } from '$lib/debug'
import type { GoodType } from '$lib/types'
import { epsilon } from '$lib/utils'
import { AxialKeyMap } from '$lib/utils/mem'
import {
	axialDistance,
	type Position,
	type Positioned,
	toAxialCoord,
	toWorldCoord,
} from '../../utils/position'
import { GameObject, withGenerator, withTicked } from '../object'
import {
	allocationEnded,
	guardAllocation,
	invalidateAllocation,
	isAllocationValid,
} from '../storage/guard'

@unreactive
class FreeGoodAllocation {
	constructor(
		public readonly freeGood: FreeGood,
		reason: any,
	) {
		guardAllocation(this, reason)
	}

	@atomic
	cancel(): void {
		if (!isAllocationValid(this)) return
		allocationEnded(this)
		invalidateAllocation(this)
		this.freeGood.available = true
	}
	@atomic
	fulfill(): void {
		if (!isAllocationValid(this)) return
		allocationEnded(this)
		invalidateAllocation(this)
		this.freeGood.remove()
	}
}

export interface FreeGood {
	goodType: GoodType
	position: Position
	available: boolean
	get isRemoved(): boolean
	remove(): void
	allocate(reason: any): FreeGoodAllocation
}

export class FreeGoods extends withTicked(withGenerator(GameObject)) {
	private readonly goods = reactive(new AxialKeyMap<FreeGood[]>([], () => []))
	private readonly display = new Map<FreeGood, { sprite: Sprite; cleanup: ScopedCallback }>()
	private readonly fgContainer: Container = new Container()
	render() {
		this.game.freeGoodsLayer.addChild(this.fgContainer)
		return () => {
			this.game.freeGoodsLayer.removeChild(this.fgContainer)
		}
	}
	add(pos: Positioned, goodType: GoodType, options: Partial<FreeGood> = {}) {
		assert(
			!('position' in options) ||
				axialDistance(options.position!, toAxialCoord(pos)) < 0.5 + epsilon,
			'`position` in options must be roughly the same as pos.position',
		)
		const coord = toAxialCoord(pos)
		const self = this
		const good: FreeGood = reactive({
			goodType,
			position: 'position' in pos ? pos.position : pos,
			available: true,
			get isRemoved() {
				const coord = toAxialCoord(pos)
				const goodsList = self.goods.get(coord) || []
				return !goodsList.includes(good)
			},
			remove: () => this.remove(pos, good),
			allocate: (reason: any): FreeGoodAllocation => {
				if (!good.available) {
					throw new Error(`FreeGood already allocated: ${reason}`)
				}
				if (good.isRemoved) {
					debugger
					throw new Error(`FreeGood already removed: ${reason}`)
				}
				good.available = false
				return new FreeGoodAllocation(good, reason)
			},
			...options,
		})
		this.goods.set(coord, [...(this.goods.get(coord) || []), good])

		// Create sprite after game is loaded
		const sprite = new Sprite(this.game.getTexture(`goods.${good.goodType}`))
		sprite.anchor.set(0.5, 0.5) // Center the sprite anchor
		this.fgContainer.addChild(sprite)
		this.game.hex.resizeSprite(sprite, 0.8)
		this.display.set(good, {
			sprite,
			cleanup: namedEffect('freeGood.render', () => {
				const { x, y } = toWorldCoord(good.position)
				sprite.position.set(x, y)

				// Apply reddish tint when allocated (like reserved goods in storage)
				if (!good.available) {
					sprite.tint = 0xff6666 // Light red tint
					sprite.alpha = 0.7
				} else {
					sprite.tint = 0xffffff // White (no tint)
					sprite.alpha = 1.0
				}

				// Return cleanup function (no-op in this case since we're just setting properties)
				return () => {}
			}),
		})

		return good
	}
	remove(pos: Positioned, good: FreeGood): void {
		// Guard against double-removal
		if (good.isRemoved) return

		const coord = toAxialCoord(pos)
		const oldList = this.goods.get(coord)!
		const newList = oldList.filter((g) => g !== good)
		assert(newList.length === oldList.length - 1, 'FreeGood not found')
		if (newList.length) this.goods.set(coord, newList)
		else this.goods.delete(coord)

		// Clean up sprite if it exists (might not exist if removed before game loaded)
		const display = this.display.get(good)
		if (display) {
			display.cleanup()
			display.sprite.destroy()
			this.display.delete(good)
		}
	}

	getGoodsAt(coord: Positioned): FreeGood[] {
		return this.goods.get(toAxialCoord(coord)) || []
	}

	findNearestGoods(
		start: Positioned,
		_center: Positioned,
		goodTypes: GoodType[],
		maxWalkTime: number,
	): { goodType: GoodType; path: Positioned[] } | undefined {
		const path = this.game.hex.findNearest(
			start,
			(coord: Positioned) => {
				const goodsList = this.getGoodsAt(coord)
				return goodsList.some((g) => goodTypes.includes(g.goodType) && g.available)
			},
			maxWalkTime, // Use walk time directly as stop condition
		)

		if (path) {
			const destination = path[path.length - 1]
			const goodsList = this.getGoodsAt(destination)
			const foundGood = goodsList.find((g) => goodTypes.includes(g.goodType) && g.available)

			if (foundGood) {
				return { goodType: foundGood.goodType, path }
			}
		}

		return undefined
	}

	update(deltaSeconds: number): void {
		// Process each coordinate's goods
		for (const [, goodsList] of this.goods.entries()) {
			for (const good of goodsList) {
				const goodDef = goods[good.goodType]
				const halfLife = goodDef.halfLife // in seconds

				// Skip decay for goods with infinite half-life
				if (!Number.isFinite(halfLife)) {
					continue
				}

				// Calculate decay probability using the formula: P = 1 - 2^(-deltaTime/halfLife)
				const decayProbability = 1 - 2 ** (-deltaSeconds / halfLife)

				// Random chance to decay
				if (this.game.random() < decayProbability) good.remove()
			}
		}
	}
}
