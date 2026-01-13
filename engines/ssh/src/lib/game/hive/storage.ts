import { reactive } from 'mutts'
import type { Character } from '$lib/game/population/character'
import type { GoodType, Job } from '$lib/types'
import type { ExchangePriority, GoodsRelations } from '$lib/utils/advertisement'
import { Alveolus } from '../board/content/alveolus'
import type { Tile } from '../board/tile'
import { SpecificStorage } from '../storage'
import { SlottedStorage } from '../storage/slotted-storage'

@reactive
export class StorageAlveolus extends Alveolus {
	declare action: Ssh.StorageAction
	storageMode: 'all-but' | 'only' = 'all-but'
	storageExceptions: GoodType[] = []
	storageBuffers: Partial<Record<GoodType, number>> = {}

	constructor(tile: Tile) {
		const def: Ssh.AlveolusDefinition = new.target.prototype
		if (def.action.type !== 'storage') {
			throw new Error('StorageAlveolus can only be created from a storage action')
		}
		const storage =
			'slots' in def.action
				? new SlottedStorage(def.action.slots, def.action.capacity)
				: new SpecificStorage(def.action)
		super(tile, storage)
	}

	/**
	 * Check if this storage can store a specific good
	 */
	canTake(goodType: GoodType, priority: ExchangePriority) {
		// Only accept goods if working is enabled
		if (!this.working || Number(priority[0]) <= 0) return false

		// 1. Buffer check: if we are below buffer, we ALWAYS accept (if there is room)
		const buffer = this.storageBuffers[goodType] || 0
		const piecesNeeded =
			this.storage instanceof SlottedStorage ? buffer * this.storage.maxQuantityPerSlot : buffer

		if ((this.storage.stock[goodType] || 0) < piecesNeeded) {
			return this.storage.hasRoom(goodType) > 0
		}

		// 2. Acceptance filter
		const isException = this.storageExceptions.includes(goodType)
		const allowedByMode = this.storageMode === 'all-but' ? !isException : isException

		return allowedByMode ? this.storage.hasRoom(goodType) > 0 : false
	}
	canGive(goodType: GoodType, priority: ExchangePriority) {
		return this.working && Number(priority[0]) > 0 ? this.storage.available(goodType) > 0 : false
	}

	get workingGoodsRelations(): GoodsRelations {
		const relations: GoodsRelations = {}

		// 1. Buffers as demand (high priority)
		for (const [goodType, buffer] of Object.entries(this.storageBuffers) as [GoodType, number][]) {
			const piecesNeeded =
				this.storage instanceof SlottedStorage ? buffer * this.storage.maxQuantityPerSlot : buffer
			const current = this.storage.stock[goodType] || 0
			if (current < piecesNeeded) {
				relations[goodType] = { advertisement: 'demand', priority: '1-buffer' }
			}
		}

		// 2. Acceptance filter as demand (low priority)
		if (this.storageMode === 'only') {
			for (const goodType of this.storageExceptions) {
				if (!relations[goodType] && this.storage.hasRoom(goodType) > 0) {
					relations[goodType] = { advertisement: 'demand', priority: '0-store' }
				}
			}
		} else {
			// For SpecificStorage in "all-but" mode, we demand everything we have room for
			if (this.storage instanceof SpecificStorage) {
				for (const goodType of Object.keys(this.storage.maxAmounts) as GoodType[]) {
					if (
						!this.storageExceptions.includes(goodType) &&
						!relations[goodType] &&
						this.storage.hasRoom(goodType) > 0
					) {
						relations[goodType] = { advertisement: 'demand', priority: '0-store' }
					}
				}
			}
			// For SlottedStorage in "all-but" mode, it's more passive.
			// It doesn't know what to demand specifically unless buffered, but will accept via canTake.
		}

		// 3. Provide for what we have availables
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
