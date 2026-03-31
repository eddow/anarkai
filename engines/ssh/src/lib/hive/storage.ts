import { inert, reactive } from 'mutts'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import { traces } from 'ssh/debug'
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

		let result = false
		let debugInfo: any = { working: this.working }
		const hasRoom = this.storage.hasRoom(goodType)

		if (this.storage instanceof SlottedStorage) {
			const availableSlots = this.storage.slots.filter((slot, _index) => {
				const isEmpty = slot === undefined
				const canAddMore =
					slot &&
					slot.goodType === goodType &&
					slot.quantity + slot.allocated < this.storage.maxQuantityPerSlot
				return isEmpty || canAddMore
			})

			debugInfo = {
				...debugInfo,
				storageType: 'SlottedStorage',
				hasRoom,
				totalSlots: this.storage.slots.length,
				availableSlots: availableSlots.length,
				maxQuantityPerSlot: this.storage.maxQuantityPerSlot,
				slots: this.storage.slots.map((slot, i) => ({
					index: i,
					goodType: slot?.goodType,
					quantity: slot?.quantity,
					allocated: slot?.allocated,
					reserved: slot?.reserved,
					available: slot ? Math.max(0, slot.quantity - slot.reserved) : 0,
				})),
			}

			result = hasRoom > 0
		} else if (this.storage instanceof SpecificStorage) {
			const current = this.storage.stock[goodType] ?? 0
			const max = this.storage.maxAmounts[goodType] ?? 0

			debugInfo = {
				...debugInfo,
				storageType: 'SpecificStorage',
				current,
				max,
				hasRoom,
				maxAmounts: this.storage.maxAmounts,
			}

			result = hasRoom > 0
		} else {
			debugInfo = {
				...debugInfo,
				storageType: 'Other',
				hasRoom,
			}
			result = hasRoom > 0
		}

		// Debug logging - always log to console for visibility (log both success and failure)
		console.log(`[CANTAKE] ${this.name} can take ${goodType}:`, {
			...debugInfo,
			result,
			timestamp: Date.now(),
		})
		if (result && traces.allocations) {
			traces.allocations.log(`[CANTAKE] ${this.name} can take ${goodType}:`, debugInfo)
		}

		return result
	}

	canGive(goodType: GoodType, priority: ExchangePriority) {
		if (!this.working || Number(priority[0]) <= 0) return false

		// Check available goods (stock minus reservations), not total stock
		const available = this.storage.availables[goodType] ?? 0
		const stock = this.storage.stock[goodType] ?? 0
		const result = available > 0

		// Debug logging - always log to console for visibility (log both success and failure)
		console.log(`[CANGIVE] ${this.name} can give ${goodType}:`, {
			available,
			stock,
			working: this.working,
			priority,
			result,
			timestamp: Date.now(),
		})

		if (result && traces.allocations) {
			traces.allocations.log(`[CANGIVE] ${this.name} can give ${goodType}:`, {
				available,
				stock,
				working: this.working,
				priority,
				timestamp: Date.now(),
			})
		}

		return result
	}

	get workingGoodsRelations(): GoodsRelations {
		const relations: GoodsRelations = {}

		// General storages already participate in matching through Hive.generalStorages.canTake/canGive.
		// They should only advertise explicit buffer shortages and excess provide, not generic "store anything"
		// demand, otherwise they can create self-sustaining demand/provide churn.
		if (this.storage instanceof SlottedStorage) {
			const allGoods = Object.keys(allGoodsList) as GoodType[]
			const { buffers } = this
			// Count empty slots and stock per type — only reads quantity/goodType, never reserved/allocated
			let emptySlotCount = 0
			const stockPerType = new Map<GoodType, number>()
			const partialSlotRoom = new Map<GoodType, boolean>()
			for (const slot of this.storage.slots) {
				if (slot === undefined || slot.quantity <= 0) {
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
				if (hasRoom && stockQty < bufferAmount) {
					relations[goodType] = {
						advertisement: 'demand',
						priority: '1-buffer',
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
				if (stockQty < maxAmount && stockQty < bufferAmount) {
					relations[goodType] = {
						advertisement: 'demand',
						priority: '1-buffer',
					}
				}
			}
		}

		return relations
	}

	nextJob(_character?: Character): Job | undefined {
		return inert(() => {
			const fragmentedGoodType = this.storage.fragmented
			return fragmentedGoodType
				? ({
						job: 'defragment',
						fatigue: 1,
						urgency: 0.9,
						goodType: fragmentedGoodType,
					} as Job)
				: undefined
		})
	}
}
