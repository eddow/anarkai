import { goods } from 'engine-rules'
import { reactive, untracked, unwrap } from 'mutts'
import { Commitment, type FailureReason } from 'ssh/commitment'
import { traces } from 'ssh/dev/debug'

import { traceProjection } from 'ssh/dev/trace'
import { GameObject } from 'ssh/game/object'
import type { GoodType } from 'ssh/types'
import { epsilon } from 'ssh/utils'
import { type AxialKey, axial } from 'ssh/utils/axial'
import { AxialKeyMap } from 'ssh/utils/mem'
import { axialDistance, type Position, type Positioned, toAxialCoord } from 'ssh/utils/position'

export interface LooseGood {
	goodType: GoodType
	position: Position
	/**
	 * The commitment currently claiming this good, if any. A claim reserves the good for a specific
	 * pickup plan so two drivers cannot target the same unit. Runtime-only — never serialized; on
	 * save/load every good reloads unclaimed and commitments are re-created.
	 */
	claimedBy: Commitment | undefined
	/**
	 * Derived pickability: `true` only while unclaimed and not removed. Kept as a convenience
	 * during migration — prefer reading `claimedBy`/`isRemoved` directly for new code.
	 */
	readonly available: boolean
	get isRemoved(): boolean
	remove(): void
	allocate(commitment: Commitment): FailureReason
}

type LooseGoodAddOptions = {
	/** Explicit world position override; must be roughly the same tile as `pos`. */
	position?: Position
	/**
	 * Seed the good as already claimed by a private placeholder commitment. Used for transient
	 * presentation goods (convey visuals) that must never be picked by a plan.
	 */
	unavailable?: boolean
	/** Internal generation path may seed decorative goods without dirtying a generated tile. */
	preserveGeneratedTile?: boolean
}

type InternalLooseGood = LooseGood & {
	coordKey: AxialKey
	removed: boolean
	/** Transient presentation goods (convey visuals) are never picked and never decay. */
	presentation: boolean
}

export class LooseGoods extends GameObject {
	public readonly goods = reactive(new AxialKeyMap<LooseGood[]>([], () => []))
	private notifyLooseGoodsChanged(coordKey: AxialKey): void {
		const tile = this.game.hex.getTile(axial.coord(coordKey))
		if (tile) this.game.enqueueInteractiveChange(tile)
	}

	/**
	 * Unlink a known good from the tile index.
	 *
	 * A claimed good must never vanish silently under a live plan: cancel the owning claim first so
	 * the commitment releases its matching vehicle-storage reservation (and its `onCancelled`
	 * ownership clears). Marking `removed` up-front also makes re-entrant removal idempotent.
	 */
	private removeKnownGood(good: InternalLooseGood, cancelReason = 'loose-good-removed'): void {
		if (good.removed) return
		good.removed = true
		const claim = good.claimedBy
		if (claim) {
			good.claimedBy = undefined
			claim.cancel(cancelReason)
		}
		const coord = good.coordKey
		const oldList = this.goods.get(coord) || []
		const target = unwrap(good)
		const newList = oldList.filter((candidate) => unwrap(candidate) !== target)
		traces.scriptEngine.assert?.(newList.length === oldList.length - 1, 'LooseGood not found')
		if (newList.length) this.goods.set(coord, newList)
		else this.goods.delete(coord)
	}
	add(pos: Positioned, goodType: GoodType, options: LooseGoodAddOptions = {}) {
		traces.scriptEngine.assert?.(
			options.position === undefined ||
				axialDistance(options.position, toAxialCoord(pos)) < 0.5 + epsilon,
			'`position` in options must be roughly the same as pos.position'
		)
		const coord = axial.round(toAxialCoord(pos))
		const coordKey = axial.key(coord)
		const { preserveGeneratedTile = false, unavailable = false, position: positionOverride } =
			options
		const self = this
		const good: InternalLooseGood = reactive({
			goodType,
			position: positionOverride ?? ('position' in pos ? pos.position : pos),
			claimedBy: undefined,
			coordKey,
			removed: false,
			presentation: unavailable,
			get available() {
				return good.claimedBy === undefined && !good.removed
			},
			get isRemoved() {
				return good.removed
			},
			get [traceProjection]() {
				return {
					$type: 'LooseGood',
					goodType: good.goodType,
					position: good.position,
					available: good.available,
					claimed: good.claimedBy !== undefined,
					removed: good.isRemoved,
				}
			},
			remove() {
				self.remove(good)
			},
			allocate: (commitment: Commitment): FailureReason => {
				if (good.claimedBy !== undefined) {
					return 'LooseGood already allocated'
				}
				if (good.isRemoved) {
					return 'LooseGood already removed'
				}
				good.claimedBy = commitment
				// A claim changes what planners can offer: bump so `candidateVersion`-memoized
				// snapshots (stop measures, further-goods) recompute instead of reading stale counts.
				self.game.invalidateWorkPlanning('loose-good.claim')
				self.notifyLooseGoodsChanged(good.coordKey)

				// Register lifecycle callbacks on the commitment
				commitment.onFulfilled(() => {
					self.remove(good)
				})
				commitment.onCancelled(() => {
					if (good.claimedBy === commitment) {
						good.claimedBy = undefined
						self.game.invalidateWorkPlanning('loose-good.unclaim')
						self.notifyLooseGoodsChanged(good.coordKey)
					}
				})

				return undefined
			},
		})
		this.goods.set(coordKey, [...(this.goods.get(coordKey) || []), good])
		if (!preserveGeneratedTile) {
			const tile = this.game.hex.getTile(coord)
			if (tile) tile.asGenerated = false
		}
		// Transient presentation goods (convey visuals) are never picked, so they start claimed by a
		// private placeholder. `removeKnownGood` cancels it when the visual is removed, resolving the
		// commitment and keeping the GC guard quiet.
		if (unavailable) {
			good.allocate(new Commitment('loose-good.presentation'))
		}
		this.game.invalidateWorkPlanning('loose-good.add')
		this.notifyLooseGoodsChanged(coordKey)

		// Create sprite after game is loaded

		return good
	}
	private remove(good: LooseGood): void {
		// Guard against double-removal
		if (good.isRemoved) {
			return
		}

		const internalGood = good as InternalLooseGood
		this.removeKnownGood(internalGood)
		const tile = this.game.hex.getTile(axial.coord(internalGood.coordKey))
		if (tile) tile.asGenerated = false
		this.game.invalidateWorkPlanning('loose-good.remove')
		this.notifyLooseGoodsChanged(internalGood.coordKey)

		// Clean up sprite if it exists (might not exist if removed before game loaded)
	}

	getGoodsAt(coord: Positioned): LooseGood[] {
		return this.goods.get(axial.round(toAxialCoord(coord))) || []
	}

	findAndAllocate(
		coord: Positioned,
		goodType: GoodType | undefined,
		commitment: Commitment
	): FailureReason {
		const goodsList = this.goods.get(axial.round(toAxialCoord(coord)))
		if (!goodsList) return 'No loose goods at this position'

		// Find first available matching good
		for (const good of goodsList) {
			if (
				good.claimedBy === undefined &&
				!good.isRemoved &&
				(!goodType || good.goodType === goodType)
			) {
				const result = good.allocate(commitment)
				if (result === undefined) return undefined
			}
		}
		return 'No available loose goods matching criteria'
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
				return goodsList.some(
					(g) =>
						goodTypes.includes(g.goodType) && g.claimedBy === undefined && !g.isRemoved
				)
			},
			maxWalkTime // Use walk time directly as stop condition
		)

		if (path) {
			const destination = path[path.length - 1]
			const goodsList = this.getGoodsAt(destination)
			const foundGood = goodsList.find(
				(g) =>
					goodTypes.includes(g.goodType) && g.claimedBy === undefined && !g.isRemoved
			)

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

	applyDecay(deltaSeconds: number): void {
		untracked`update`(() => {
			// Process each coordinate's goods
			for (const [, goodsList] of Array.from(this.goods.entries())) {
				const decayBuckets = new Map<GoodType, InternalLooseGood[]>()
				for (const good of goodsList as InternalLooseGood[]) {
					const goodDef = goods[good.goodType]
					if (!goodDef) {
						traces.scriptEngine.error?.(
							`LooseGood update: Unknown good type '${good.goodType}'. Goods keys: ${Object.keys(goods).join(', ')}`
						)
						continue
					}
					const halfLife = goodDef.halfLife // in seconds

					// Skip decay for goods with infinite half-life
					if (!Number.isFinite(halfLife)) {
						continue
					}

					// Transient presentation goods (convey visuals) are removed by the convey step, not
					// by decay — decaying them mid-flight would teleport the in-transit visual away.
					if (good.presentation) continue

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
					// A claimed good is not skipped: decay cancels its claim (freeing the matching
					// vehicle-storage reservation) and then removes it, so a live plan replans instead
					// of chasing a unit that silently vanished.
					this.removeKnownGood(good, 'loose-decayed')
				}
			}
		})
	}
}
