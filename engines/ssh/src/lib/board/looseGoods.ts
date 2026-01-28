import { atomic, reactive, unreactive, untracked } from 'mutts'

import { goods } from '../../../assets/game-content'
import { assert } from 'ssh/debug'
import { GameObject, withTicked } from 'ssh/game/object'
import {
	allocationEnded,
	guardAllocation,
	invalidateAllocation,
	isAllocationValid,
} from 'ssh/storage/guard'
import type { GoodType } from 'ssh/types'
import { epsilon } from 'ssh/utils'
import { AxialKeyMap } from 'ssh/utils/mem'
import { axialDistance, type Position, type Positioned, toAxialCoord } from 'ssh/utils/position'

@unreactive
class LooseGoodAllocation {
	constructor(
		public readonly looseGood: LooseGood,
		reason: any,
	) {
		guardAllocation(this, reason)
	}

	@atomic
	cancel(): void {
		if (!isAllocationValid(this)) return
		allocationEnded(this)
		invalidateAllocation(this)
		this.looseGood.available = true
	}
	@atomic
	fulfill(): void {
		if (!isAllocationValid(this)) return
		allocationEnded(this)
		invalidateAllocation(this)
		this.looseGood.remove()
	}
}

export interface LooseGood {
	goodType: GoodType
	position: Position
	available: boolean
	get isRemoved(): boolean
	remove(): void
	allocate(reason: any): LooseGoodAllocation
}

export class LooseGoods extends withTicked(GameObject) {
	public readonly uid = 'loose-goods-manager'
	public readonly goods = reactive(new AxialKeyMap<LooseGood[]>([], () => []))
	add(pos: Positioned, goodType: GoodType, options: Partial<LooseGood> = {}) {
		assert(
			!('position' in options) ||
				axialDistance(options.position!, toAxialCoord(pos)) < 0.5 + epsilon,
			'`position` in options must be roughly the same as pos.position',
		)
		const coord = toAxialCoord(pos)
		const self = this
		const good: LooseGood = reactive({
			goodType,
			position: 'position' in pos ? pos.position : pos,
			available: true,
			get isRemoved() {
				const coord = toAxialCoord(pos)
				const goodsList = self.goods.get(coord) || []
				return !goodsList.includes(good)
			},
			remove: () => this.remove(pos, good),
			allocate: (reason: any): LooseGoodAllocation => {
				if (!good.available) {
					throw new Error(`LooseGood already allocated: ${reason}`)
				}
				if (good.isRemoved) {
					debugger
					throw new Error(`LooseGood already removed: ${reason}`)
				}
				good.available = false
				return new LooseGoodAllocation(good, reason)
			},
			...options,
		})
		this.goods.set(coord, [...(this.goods.get(coord) || []), good])

		// Create sprite after game is loaded

		return good
	}
	remove(pos: Positioned, good: LooseGood): void {
		// Guard against double-removal
		if (good.isRemoved) return

		const coord = toAxialCoord(pos)
		const oldList = this.goods.get(coord)!
		const newList = oldList.filter((g) => g !== good)
		assert(newList.length === oldList.length - 1, 'LooseGood not found')
		if (newList.length) this.goods.set(coord, newList)
		else this.goods.delete(coord)

		// Clean up sprite if it exists (might not exist if removed before game loaded)
	}

	getGoodsAt(coord: Positioned): LooseGood[] {
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
							`LooseGood update: Unknown good type '${good.goodType}'. Goods keys: ${Object.keys(goods).join(', ')}`,
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
