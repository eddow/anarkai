import { reactive } from 'mutts'
import type { Character } from '$lib/game/population/character'
import type { GoodType, Job } from '$lib/types'
import type { ExchangePriority, GoodsRelations } from '$lib/utils/advertisement'
import { Alveolus } from '../board/content/alveolus'
import type { Tile } from '../board/tile'
import { SpecificStorage } from '../storage'
import { SlottedStorage } from '../storage/slotted-storage'
import { goods as allGoodsList } from '../../../../assets/game-content'

@reactive
export class StorageAlveolus extends Alveolus {
	declare action: Ssh.StorageAction
	public buffers = reactive(new Map<GoodType, number>())

	constructor(tile: Tile) {
		const def: Ssh.AlveolusDefinition = new.target.prototype
		
		if (def.action.type === 'slotted-storage') {
			const action = def.action as Ssh.SlottedStorageAction
			super(tile, new SlottedStorage(action.slots, action.capacity))
			if (action.buffers) {
				for (const [good, amount] of Object.entries(action.buffers)) {
					this.buffers.set(good as GoodType, amount)
				}
			}
		} else if (def.action.type === 'specific-storage') {
			const action = def.action as Ssh.SpecificStorageAction
			super(tile, new SpecificStorage(action.goods))
			if (action.buffers) {
				for (const [good, amount] of Object.entries(action.buffers)) {
					this.buffers.set(good as GoodType, amount)
				}
			}
		} else {
			throw new Error(`StorageAlveolus created with invalid action type: ${(def.action as any)?.type}`)
		}
	}

	/**
	 * Check if this storage can store a specific good
	 */
	canTake(goodType: GoodType, _priority: ExchangePriority) {
		// Only accept goods if working is enabled
		if (!this.working) return false
		return this.storage.hasRoom(goodType) > 0
	}

	canGive(goodType: GoodType, priority: ExchangePriority) {
		return this.working && Number(priority[0]) > 0 ? this.storage.available(goodType) > 0 : false
	}

	get workingGoodsRelations(): GoodsRelations {
		const relations: GoodsRelations = {}

		// Demand goods at '0-store' priority for internal conveying purposes.
		// Note: '0-store' demands are filtered OUT of hive.needs, so gatherers
		// won't collect goods just because storage has room. Only higher
		// priority demands (1-buffer, 2-use) from consuming alveoli drive gathering.
		if (this.storage instanceof SlottedStorage) {
			const allGoods = Object.keys(allGoodsList) as GoodType[]
			const { buffers } = this
			for (const goodType of allGoods) {
				if (this.storage.hasRoom(goodType) > 0) {
					// Check if we need to buffer this good
					const bufferAmount = buffers.get(goodType) || 0
					const currentAmount = this.storage.availables[goodType] || 0
					
					if (currentAmount < bufferAmount) {
						relations[goodType] = { advertisement: 'demand', priority: '1-buffer' }
					} else {
						relations[goodType] = { advertisement: 'demand', priority: '0-store' }
					}
				}
			}
		} else if (this.storage instanceof SpecificStorage) {
			const { buffers } = this
			for (const goodType of Object.keys(this.storage.maxAmounts) as GoodType[]) {
				if (this.storage.hasRoom(goodType) > 0) {
					// Check if we need to buffer this good
					const bufferAmount = buffers.get(goodType) || 0
					const currentAmount = this.storage.availables[goodType] || 0
					
					if (currentAmount < bufferAmount) {
						relations[goodType] = { advertisement: 'demand', priority: '1-buffer' }
					} else {
						relations[goodType] = { advertisement: 'demand', priority: '0-store' }
					}
				}
			}
		}

		// Provide what we have available (for consumption by sawmills, etc.)
		for (const goodType of Object.keys(this.storage.availables) as GoodType[]) {
			if (!relations[goodType]) {
				relations[goodType] = { advertisement: 'provide', priority: '0-store' }
			}
		}

		return relations
	}

	nextJob(_character?: Character): Job | undefined {
		// Check for defragment job if storage is fragmented
		const fragmentedGoodType = this.storage.fragmented
		return fragmentedGoodType
			? ({ job: 'defragment', fatigue: 1, urgency: 0.9, goodType: fragmentedGoodType } as Job)
			: undefined
	}
}
