import { reactive } from 'mutts'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import type { Character } from 'ssh/population/character'
import { SlottedStorage } from 'ssh/storage/slotted-storage'
import { SpecificStorage } from 'ssh/storage/specific-storage'
import type { GoodType, Job } from 'ssh/types'
import type { ExchangePriority, GoodsRelations } from 'ssh/utils/advertisement'
import { goods as allGoodsList, configurations } from '../../../assets/game-content'
import { isSpecificStorageConfiguration } from './alveolus-configuration'

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
		return {
			...(configurations['specific-storage'] as Ssh.SpecificStorageAlveolusConfiguration),
			working: baseConfig.working,
		}
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
			this.individualConfiguration = {
				...(configurations['specific-storage'] as Ssh.SpecificStorageAlveolusConfiguration),
			}
		}
		this.individualConfiguration.buffers = {
			...this.individualConfiguration.buffers,
			...buffers,
		}
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
			throw new Error(
				`StorageAlveolus created with invalid action type: ${(def.action as any)?.type}`
			)
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

		// Demand goods based purely on stock vs. capacity — no reservation/allocation tracking.
		// reserve()/allocate() must NOT change what we advertise; only actual goods changes should.
		if (this.storage instanceof SlottedStorage) {
			const allGoods = Object.keys(allGoodsList) as GoodType[]
			const { buffers } = this
			// Count empty slots and stock per type — only reads quantity/goodType, never reserved/allocated
			let emptySlotCount = 0
			const stockPerType = new Map<GoodType, number>()
			const partialSlotRoom = new Map<GoodType, boolean>()
			for (const slot of this.storage.slots) {
				if (slot === undefined) {
					emptySlotCount++
				} else {
					stockPerType.set(slot.goodType, (stockPerType.get(slot.goodType) ?? 0) + slot.quantity)
					if (slot.quantity < this.storage.maxQuantityPerSlot) {
						partialSlotRoom.set(slot.goodType, true)
					}
				}
			}
			for (const goodType of allGoods) {
				const stockQty = stockPerType.get(goodType) ?? 0
				const bufferAmount = buffers.get(goodType) || 0
				if (stockQty > bufferAmount) {
					relations[goodType] = {
						advertisement: 'provide',
						priority: '0-store',
					}
					continue
				}
				const hasRoom = emptySlotCount > 0 || partialSlotRoom.get(goodType) === true
				if (hasRoom) {
					if (stockQty < bufferAmount) {
						relations[goodType] = {
							advertisement: 'demand',
							priority: '1-buffer',
						}
					} else {
						relations[goodType] = {
							advertisement: 'demand',
							priority: '0-store',
						}
					}
				}
			}
		} else if (this.storage instanceof SpecificStorage) {
			const { buffers } = this
			for (const goodType of Object.keys(this.storage.maxAmounts) as GoodType[]) {
				const maxAmount = this.storage.maxAmounts[goodType] ?? 0
				const stockQty = this.storage.stock[goodType] ?? 0
				const bufferAmount = buffers.get(goodType) || 0
				if (stockQty > bufferAmount) {
					relations[goodType] = {
						advertisement: 'provide',
						priority: '0-store',
					}
					continue
				}
				if (stockQty < maxAmount) {
					if (stockQty < bufferAmount) {
						relations[goodType] = {
							advertisement: 'demand',
							priority: '1-buffer',
						}
					} else {
						relations[goodType] = {
							advertisement: 'demand',
							priority: '0-store',
						}
					}
				}
			}
		}

		return relations
	}

	nextJob(_character?: Character): Job | undefined {
		// Check for defragment job if storage is fragmented
		const fragmentedGoodType = this.storage.fragmented
		return fragmentedGoodType
			? ({
					job: 'defragment',
					fatigue: 1,
					urgency: 0.9,
					goodType: fragmentedGoodType,
				} as Job)
			: undefined
	}
}
