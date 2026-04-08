import { inert } from 'mutts'
import type { Tile } from 'ssh/board/tile'
import type { Character } from 'ssh/population/character'
import { SlottedStorage } from 'ssh/storage/slotted-storage'
import type { GatherJob, Goods, GoodType } from 'ssh/types/base'
import { type Positioned, toAxialCoord } from 'ssh/utils/position'
import { TransitAlveolus } from './transit'

function goodsWith(goods: Goods, other: GoodType, qty: number = 1): Goods {
	const rv = { ...goods }
	rv[other] = (goods[other] || 0) + qty
	return rv
}

/**
 * GatherAlveolus handles gathering loose goods from the world.
 */
export class GatherAlveolus extends TransitAlveolus {
	declare action: Ssh.GatherAction
	constructor(tile: Tile) {
		const def: Ssh.AlveolusDefinition = new.target.prototype
		if (def.action.type !== 'gather') {
			throw new Error('GatherAlveolus can only be created from a gather action')
		}
		super(tile, new SlottedStorage(1, 12))
	}

	get hasLooseGoodsToGather(): boolean {
		// Check if there are any loose goods in the world that the hive needs
		const hiveNeeds = Object.keys(this.hive.needs) as GoodType[]
		if (hiveNeeds.length === 0) return false

		// Use LooseGoods.findNearestGoods to check if there are any loose goods available within walk time
		const nearestGoods = this.tile.game.hex.looseGoods.findNearestGoods(
			toAxialCoord(this.tile.position),
			toAxialCoord(this.tile.position), // Center is the same as start for gather
			hiveNeeds,
			this.action.radius
		)
		return nearestGoods !== undefined
	}

	// nextJob() replaces both alveolusSpecificJob() and keepWorking
	// Returns detailed job info including path when called from character
	nextJob(character?: Character): GatherJob | undefined {
		return inert(() => {
			// TODO: make sure the gather hut work "priority" depends on the amount of goods available around / amount of good transportable
			if (!this.working || !this.hasLooseGoodsToGather || !this.storage.isEmpty) return undefined

			const startPos = character
				? toAxialCoord(character.position)
				: toAxialCoord(this.tile.position)
			const hex = this.tile.game.hex

			let path: Positioned[] | undefined
			let goodType: GoodType | undefined
			let selectableGoods = Object.keys(this.hive.needs) as GoodType[]
			const carry = character?.carry
			if (carry) {
				const carriedGoods = Object.keys(carry.availables) as GoodType[]
				selectableGoods = [...new Set([...selectableGoods, ...carriedGoods])]
				selectableGoods = selectableGoods.filter(
					(good) => carry.hasRoom(good) && this.storage.canStoreAll(goodsWith(carry.stock, good))
				)
			}

			if (selectableGoods.length === 0) return undefined

			const goodCounts = Object.fromEntries(selectableGoods.map((good) => [good, 0])) as Goods

			hex.findNearest(
				startPos,
				(pos: Positioned) => {
					const goodsAtTile = hex.looseGoods.getGoodsAt(pos)
					for (const good of goodsAtTile) {
						const gt = good.goodType as GoodType
						if (good.available && gt in goodCounts) goodCounts[gt]!++
					}
					return false
				},
				this.action.radius,
				false
			)

			const targetGood = Object.entries(goodCounts).reduce(
				(max, [good, count]) => (count > max.count ? { good: good as GoodType, count } : max),
				{ good: null as GoodType | null, count: 0 }
			).good

			if (!targetGood) return undefined

			const result = hex.looseGoods.findNearestGoods(
				startPos,
				startPos,
				[targetGood],
				this.action.radius
			)
			if (result) {
				path = result.path
				goodType = targetGood
			}

			return (
				path && {
					job: 'gather',
					path,
					goodType,
					urgency: 2.5,
					fatigue: this.getFatigueCost(),
				}
			)
		})
	}
}
