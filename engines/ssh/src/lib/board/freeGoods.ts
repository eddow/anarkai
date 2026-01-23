import { atomic, reactive, unreactive, untracked } from 'mutts'

import { goods } from '../../../assets/game-content'
import { assert } from 'ssh/src/lib/debug'
import { GameObject, withTicked } from 'ssh/src/lib/game/object'
import {
	allocationEnded,
	guardAllocation,
	invalidateAllocation,
	isAllocationValid,
} from 'ssh/src/lib/storage/guard'
import type { GoodType } from 'ssh/src/lib/types'
import { epsilon } from 'ssh/src/lib/utils'
import { AxialKeyMap } from 'ssh/src/lib/utils/mem'
import { axialDistance, type Position, type Positioned, toAxialCoord } from 'ssh/src/lib/utils/position'

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

export class FreeGoods extends withTicked(GameObject) {
	public readonly uid = 'free-goods-manager'
	public readonly goods = reactive(new AxialKeyMap<FreeGood[]>([], () => []))
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
		untracked(() => {
			// Process each coordinate's goods
			for (const [, goodsList] of this.goods.entries()) {
				for (const good of goodsList) {
					const goodDef = goods[good.goodType]
					if (!goodDef) {
						console.error(
							`FreeGood update: Unknown good type '${good.goodType}'. Goods keys: ${Object.keys(goods).join(', ')}`,
						)
						continue
					}
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
		})
	}
}
