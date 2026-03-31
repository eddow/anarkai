import { atomic, reactive, unreactive, untracked, unwrap } from 'mutts'
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
import { axial } from 'ssh/utils/axial'
import { AxialKeyMap } from 'ssh/utils/mem'
import { axialDistance, type Position, type Positioned, toAxialCoord } from 'ssh/utils/position'
import { goods } from '../../../assets/game-content'

@unreactive
class LooseGoodAllocation {
	constructor(
		public readonly looseGood: LooseGood,
		reason: any
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
	private findGoodCoord(good: LooseGood) {
		const target = unwrap(good)
		for (const [coord, goods] of this.goods.entries()) {
			if (goods.some((candidate) => unwrap(candidate) === target)) return coord
		}
		return undefined
	}
	add(pos: Positioned, goodType: GoodType, options: Partial<LooseGood> = {}) {
		assert(
			!('position' in options) ||
				axialDistance(options.position!, toAxialCoord(pos)) < 0.5 + epsilon,
			'`position` in options must be roughly the same as pos.position'
		)
		const coord = axial.round(toAxialCoord(pos))
		const self = this
		const good: LooseGood = reactive({
			goodType,
			position: 'position' in pos ? pos.position : pos,
			available: true,
			get isRemoved() {
				return self.findGoodCoord(good) === undefined
			},
			remove() {
				if (this.isRemoved) {
					console.error('LooseGood.remove called on already-removed object (isRemoved=true)', {
						goodType: this.goodType,
						available: this.available,
					})
				}
				self.remove(this.position, good)
			},
			allocate: (reason: any): LooseGoodAllocation => {
				if (!good.available) {
					throw new Error(`LooseGood already allocated: ${reason}`)
				}
				if (good.isRemoved) {
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
		if (good.isRemoved) {
			console.warn(
				'LooseGood.remove called on already-removed good',
				good.goodType,
				new Error().stack?.split('\n').slice(1, 5).join('\n')
			)
			return
		}

		const requestedCoord = axial.round(toAxialCoord(pos))
		const hasSameIdentity = (candidate: LooseGood) => unwrap(candidate) === unwrap(good)
		const coord = this.findGoodCoord(good) ?? requestedCoord
		const oldList = this.goods.get(coord) || []
		const newList = oldList.filter((g) => !hasSameIdentity(g))
		assert(newList.length === oldList.length - 1, 'LooseGood not found')
		if (newList.length) this.goods.set(coord, newList)
		else this.goods.delete(coord)

		// Clean up sprite if it exists (might not exist if removed before game loaded)
	}

	getGoodsAt(coord: Positioned): LooseGood[] {
		return this.goods.get(axial.round(toAxialCoord(coord))) || []
	}

	findAndAllocate(
		coord: Positioned,
		goodType?: GoodType,
		reason?: any
	): LooseGoodAllocation | null {
		const goodsList = this.goods.get(axial.round(toAxialCoord(coord)))
		if (!goodsList) return null

		// Find first available matching good
		for (const good of goodsList) {
			if (good.available && (!goodType || good.goodType === goodType)) {
				try {
					return good.allocate(reason || 'findAndAllocate')
				} catch (_e) {}
			}
		}
		return null
	}

	findNearestGoods(
		start: Positioned,
		_center: Positioned,
		goodTypes: GoodType[],
		maxWalkTime: number
	): { goodType: GoodType; path: Positioned[] } | undefined {
		const path = this.game.hex.findNearest(
			start,
			(coord: Positioned) => {
				const goodsList = this.getGoodsAt(coord)
				return goodsList.some((g) => goodTypes.includes(g.goodType) && g.available)
			},
			maxWalkTime // Use walk time directly as stop condition
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
		untracked`update`(() => {
			// Process each coordinate's goods
			for (const [, goodsList] of Array.from(this.goods.entries())) {
				for (const good of [...goodsList]) {
					if (good.isRemoved) continue
					const goodDef = goods[good.goodType]
					if (!goodDef) {
						console.error(
							`LooseGood update: Unknown good type '${good.goodType}'. Goods keys: ${Object.keys(goods).join(', ')}`
						)
						continue
					}
					const halfLife = goodDef.halfLife // in seconds

					// Skip decay for goods with infinite half-life
					if (!Number.isFinite(halfLife)) {
						continue
					}

					// Skip decay for allocated goods (available=false means being grabbed)
					if (!good.available) continue

					// Calculate decay probability using the formula: P = 1 - 2^(-deltaTime/halfLife)
					const decayProbability = 1 - 2 ** (-deltaSeconds / halfLife)

					// Random chance to decay
					if (this.game.random() < decayProbability) good.remove()
				}
			}
		})
	}
}
