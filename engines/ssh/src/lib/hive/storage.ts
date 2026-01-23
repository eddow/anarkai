import { reactive } from 'mutts'
import type { Character } from '$lib/population/character'
import type { GoodType, Job } from '$lib/types'
import type { ExchangePriority, GoodsRelations } from '$lib/utils/advertisement'
import { Alveolus } from '$lib/board/content/alveolus'
import type { Tile } from '$lib/board/tile'
import { SpecificStorage } from '$lib/storage/specific-storage'
import { SlottedStorage } from '$lib/storage/slotted-storage'
import { goods as allGoodsList, configurations } from '$assets/game-content'
import {
	isSpecificStorageConfiguration,
} from './alveolus-configuration'

@reactive
export class StorageAlveolus extends Alveolus {
	declare action: Ssh.StorageAction

	/**
	 * Individual configuration specific to storage alveoli.
	 * Overrides the base class type to include buffers.
	 */
	declare individualConfiguration: Ssh.SpecificStorageAlveolusConfiguration | undefined

	/**
	 * Get the effective storage configuration.
	 * Extends base class configuration with storage-specific defaults.
	 */
	get storageConfiguration(): Ssh.SpecificStorageAlveolusConfiguration {
		const baseConfig = this.configuration
		if (isSpecificStorageConfiguration(baseConfig)) {
			return baseConfig
		}
		// Base config doesn't have buffers, return storage default with working from base
		return { ...(configurations['specific-storage'] as Ssh.SpecificStorageAlveolusConfiguration), working: baseConfig.working }
	}

	/**
	 * Get buffers from configuration.
	 * Returns a Map for compatibility with existing code.
	 */
	get buffers(): Map<GoodType, number> {
		const config = this.storageConfiguration
		const map = new Map<GoodType, number>()
		for (const [good, amount] of Object.entries(config.buffers)) {
			if (amount !== undefined) {
				map.set(good as GoodType, amount)
			}
		}
		return map
	}

	/**
	 * Set buffers by updating individual configuration.
	 */
	setBuffers(buffers: Record<string, number>): void {
		if (!this.individualConfiguration) {
			this.individualConfiguration = { ...(configurations['specific-storage'] as Ssh.SpecificStorageAlveolusConfiguration) }
		}
		this.individualConfiguration.buffers = { ...this.individualConfiguration.buffers, ...buffers }
		if (this.configurationRef.scope !== 'individual') {
			this.configurationRef = { scope: 'individual' }
		}
	}

	/**
	 * Setter for backward compatibility with tests.
	 */
	set storageBuffers(buffers: Partial<Record<GoodType, number>>) {
		this.setBuffers(buffers)
	}

	constructor(tile: Tile) {
		const def: Ssh.AlveolusDefinition = new.target.prototype
		
		if (def.action.type === 'slotted-storage') {
			const action = def.action as Ssh.SlottedStorageAction
			super(tile, new SlottedStorage(action.slots, action.capacity))
			// Legacy: if action has buffers defined, set them as individual config
			if (action.buffers) {
				this.individualConfiguration = {
					working: true,
					buffers: action.buffers as Partial<Record<GoodType, number>>,
				}
				this.configurationRef = { scope: 'individual' }
			}
		} else if (def.action.type === 'specific-storage') {
			const action = def.action as Ssh.SpecificStorageAction
			super(tile, new SpecificStorage(action.goods))
			// Legacy: if action has buffers defined, set them as individual config
			if (action.buffers) {
				this.individualConfiguration = {
					working: true,
					buffers: action.buffers as Partial<Record<GoodType, number>>,
				}
				this.configurationRef = { scope: 'individual' }
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
