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
import { type AxialKey, axial } from 'ssh/utils/axial'
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

type InternalLooseGood = LooseGood & {
	coordKey: AxialKey
	removed: boolean
}

export class LooseGoods extends withTicked(GameObject) {
	public readonly uid = 'loose-goods-manager'
	public readonly goods = reactive(new AxialKeyMap<LooseGood[]>([], () => []))
	private removeKnownGood(good: InternalLooseGood): void {
		const coord = good.coordKey
		const oldList = this.goods.get(coord) || []
		const target = unwrap(good)
		const newList = oldList.filter((candidate) => unwrap(candidate) !== target)
		assert(newList.length === oldList.length - 1, 'LooseGood not found')
		if (newList.length) this.goods.set(coord, newList)
		else this.goods.delete(coord)
		good.removed = true
	}
	add(pos: Positioned, goodType: GoodType, options: Partial<LooseGood> = {}) {
		assert(
			!('position' in options) ||
				axialDistance(options.position!, toAxialCoord(pos)) < 0.5 + epsilon,
			'`position` in options must be roughly the same as pos.position'
		)
		const coord = axial.round(toAxialCoord(pos))
		const coordKey = axial.key(coord)
		const self = this
		const good: InternalLooseGood = reactive({
			goodType,
			position: 'position' in pos ? pos.position : pos,
			available: true,
			coordKey,
			removed: false,
			get isRemoved() {
				return good.removed
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
		this.goods.set(coordKey, [...(this.goods.get(coordKey) || []), good])

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

		const internalGood = good as InternalLooseGood
		const requestedCoord = axial.key(axial.round(toAxialCoord(pos)))
		if (internalGood.coordKey !== requestedCoord) {
			console.warn('LooseGood.remove called with mismatched position', {
				requestedCoord,
				storedCoord: internalGood.coordKey,
				goodType: good.goodType,
			})
		}
		this.removeKnownGood(internalGood)

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

	private samplePoisson(mean: number): number {
		if (mean <= 0) return 0
		const threshold = Math.exp(-mean)
		let product = 1
		let count = 0
		while (product > threshold) {
			product *= this.game.random()
			count++
		}
		return count - 1
	}

	private sampleBinomial(trials: number, probability: number): number {
		if (trials <= 0 || probability <= 0) return 0
		if (probability >= 1) return trials

		const mean = trials * probability
		if (trials <= 16) {
			let hits = 0
			for (let i = 0; i < trials; i++) {
				if (this.game.random() < probability) hits++
			}
			return hits
		}
		if (mean < 1) return Math.min(trials, this.samplePoisson(mean))

		const variance = mean * (1 - probability)
		const u1 = Math.max(this.game.random(), Number.MIN_VALUE)
		const u2 = this.game.random()
		const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
		return Math.max(0, Math.min(trials, Math.round(mean + normal * Math.sqrt(variance))))
	}

	private selectRandomGoods(bucket: InternalLooseGood[], count: number): InternalLooseGood[] {
		const selectedCount = Math.min(count, bucket.length)
		for (let i = 0; i < selectedCount; i++) {
			const swapIndex = i + Math.floor(this.game.random(bucket.length - i))
			;[bucket[i], bucket[swapIndex]] = [bucket[swapIndex], bucket[i]]
		}
		return bucket.slice(0, selectedCount)
	}

	update(deltaSeconds: number): void {
		untracked`update`(() => {
			// Process each coordinate's goods
			for (const [, goodsList] of Array.from(this.goods.entries())) {
				const decayBuckets = new Map<GoodType, InternalLooseGood[]>()
				for (const good of goodsList as InternalLooseGood[]) {
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

					const bucket = decayBuckets.get(good.goodType)
					if (bucket) bucket.push(good)
					else decayBuckets.set(good.goodType, [good])
				}

				const goodsToRemove: InternalLooseGood[] = []
				for (const [goodType, bucket] of decayBuckets) {
					const halfLife = goods[goodType]?.halfLife
					if (!Number.isFinite(halfLife)) continue
					const decayProbability = 1 - 2 ** (-deltaSeconds / halfLife)
					const kills = this.sampleBinomial(bucket.length, decayProbability)
					if (kills <= 0) continue
					goodsToRemove.push(...this.selectRandomGoods(bucket, kills))
				}

				for (const good of goodsToRemove) {
					if (good.removed) continue
					this.removeKnownGood(good)
				}
			}
		})
	}
}
