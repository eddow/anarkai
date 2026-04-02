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
import {
	isSlottedStorageConfiguration,
	isSpecificStorageConfiguration,
} from './alveolus-configuration'

function clampSlotCount(value: number, maximum: number): number {
	if (!Number.isFinite(value)) return 0
	return Math.max(0, Math.min(maximum, Math.floor(value)))
}

function sumBufferedSlots(
	goods: Record<string, Ssh.SlottedStorageGoodConfiguration | undefined>
): number {
	let total = 0
	for (const rule of Object.values(goods)) {
		if (!rule) continue
		total += rule.minSlots
	}
	return total
}

@reactive
export class StorageAlveolus extends Alveolus {
	declare action: Ssh.StorageAction

	/**
	 * Individual configuration specific to storage alveoli.
	 * Overrides the base class type to include buffers.
	 */
	declare individualConfiguration: Ssh.StorageAlveolusConfiguration | undefined

	/**
	 * Get the effective storage configuration.
	 * Extends base class configuration with storage-specific defaults.
	 */
	get storageConfiguration(): Ssh.StorageAlveolusConfiguration {
		return this.action.type === 'slotted-storage'
			? this.slottedStorageConfiguration
			: this.specificStorageConfiguration
	}

	get specificStorageConfiguration(): Ssh.SpecificStorageAlveolusConfiguration {
		const baseConfig = this.configuration
		if (isSpecificStorageConfiguration(baseConfig)) {
			return baseConfig
		}

		return {
			...(configurations['specific-storage'] as Ssh.SpecificStorageAlveolusConfiguration),
			working: baseConfig.working,
		}
	}

	get slottedStorageConfiguration(): Ssh.SlottedStorageAlveolusConfiguration {
		const baseConfig = this.configuration
		const defaults = configurations['slotted-storage'] as Ssh.SlottedStorageAlveolusConfiguration
		if (isSlottedStorageConfiguration(baseConfig)) {
			return {
				...defaults,
				working: baseConfig.working,
				generalSlots:
					baseConfig.generalSlots === undefined
						? this.slottedRemainingSlotBudget(baseConfig.goods)
						: baseConfig.generalSlots,
				goods: baseConfig.goods,
			}
		}

		return {
			...defaults,
			working: baseConfig.working,
			generalSlots: this.slottedAction.slots,
			goods: {},
		}
	}

	get storageBuffers(): Partial<Record<GoodType, number>> {
		if (this.action.type === 'specific-storage') {
			return this.specificStorageConfiguration.buffers
		}

		const buffers: Partial<Record<GoodType, number>> = {}
		const capacity =
			this.storage instanceof SlottedStorage ? this.storage.maxQuantityPerSlot : 1
		for (const [goodType, rule] of Object.entries(this.slottedStorageConfiguration.goods)) {
			if (!rule || rule.minSlots <= 0) continue
			buffers[goodType as GoodType] = rule.minSlots * capacity
		}
		return buffers
	}

	/**
	 * Get buffers from configuration.
	 * Returns a Map for compatibility with existing code.
	 */
	get buffers(): Map<GoodType, number> {
		const map = new Map<GoodType, number>()
		for (const [good, amount] of Object.entries(this.storageBuffers)) {
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
		if (this.action.type === 'specific-storage') {
			const config = this.ensureSpecificStorageConfiguration()
			config.buffers = {
				...config.buffers,
				...buffers,
			}
			return
		}

		for (const [goodType, minSlots] of Object.entries(buffers) as [GoodType, number][]) {
			const current = this.slottedStorageConfiguration.goods[goodType]
			const nextMaxSlots = current?.maxSlots ?? this.slottedRemainingSlotBudget()
			this.setSlottedGoodConfiguration(goodType, {
				minSlots,
				maxSlots: nextMaxSlots,
			})
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
				const goods: Record<string, Ssh.SlottedStorageGoodConfiguration> = {}
				for (const [goodType, minSlots] of Object.entries(action.buffers)) {
					const safeMin = clampSlotCount(minSlots, action.slots)
					if (safeMin <= 0) continue
					goods[goodType] = {
						minSlots: safeMin,
						maxSlots: 0,
					}
				}
				this.individualConfiguration = reactive({
					working: true,
					generalSlots: action.slots - sumBufferedSlots(goods),
					goods,
				})
				this.normalizeEditableSlottedConfiguration()
			}
		} else if (def.action.type === 'specific-storage') {
			const action = def.action as Ssh.SpecificStorageAction
			super(tile, new SpecificStorage(action.goods))

			// Legacy: if action has buffers defined, set them as individual config
			if (action.buffers) {
				this.individualConfiguration = reactive({
					working: true,
					buffers: action.buffers,
				})
			}
		} else {
			throw new Error(`StorageAlveolus created with invalid action type: ${def.action.type}`)
		}

		if (this.individualConfiguration) {
			this.configurationRef = { scope: 'individual' }
		}
	}

	/**
	 * Check if this storage can store a specific good
	 */
	canTake(goodType: GoodType, _priority: ExchangePriority) {
		// Only accept goods if working is enabled
		if (!this.working) return false

		let result = false
		let debugInfo: Record<string, unknown> = { working: this.working }
		const hasRoom = this.storage.hasRoom(goodType)

		if (this.storage instanceof SlottedStorage) {
			const slotUsage = this.storage.slotUsage()
			const goodSlots = slotUsage[goodType] ?? 0
			const partialRoom = this.storage.hasPartialRoomFor(goodType)
			const rule = this.slottedRule(goodType)
			const generalSlots = this.slottedGeneralSlotUsage(slotUsage)
			const canClaimNewSlot = rule
				? goodSlots < rule.minSlots + rule.maxSlots
				: generalSlots < this.slottedStorageConfiguration.generalSlots

			debugInfo = {
				...debugInfo,
				storageType: 'SlottedStorage',
				hasRoom,
				totalSlots: this.storage.slots.length,
				usedSlots: this.storage.usedSlots,
				emptySlots: this.storage.emptySlots,
				goodSlots,
				partialRoom,
				canClaimNewSlot,
				rule,
				generalSlots,
				generalSlotLimit: this.slottedStorageConfiguration.generalSlots,
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

			result = hasRoom > 0 && (partialRoom || canClaimNewSlot)
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
		if (!this.working) return false

		const available = this.storage.availables[goodType] ?? 0
		const stock = this.storage.stock[goodType] ?? 0
		const bufferedProtected = this.bufferedProtectedAmount(goodType)
		const releasable = Math.max(0, available - bufferedProtected)
		const result =
			priority === '2-use'
				? available > 0
				: this.storage instanceof SlottedStorage
					? this.slottedCanGive(goodType)
					: releasable > 0

		// Debug logging - always log to console for visibility (log both success and failure)
		console.log(`[CANGIVE] ${this.name} can give ${goodType}:`, {
			available,
			stock,
			bufferedProtected,
			releasable,
			working: this.working,
			priority,
			result,
			timestamp: Date.now(),
		})

		if (result && traces.allocations) {
			traces.allocations.log(`[CANGIVE] ${this.name} can give ${goodType}:`, {
				available,
				stock,
				bufferedProtected,
				releasable,
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
			const slotUsage = this.storage.slotUsage()
			const capacity = this.storage.maxQuantityPerSlot
			for (const goodType of allGoods) {
				const occupiedSlots = slotUsage[goodType] ?? 0
				const rule = this.slottedRule(goodType)
				if (!rule) {
					if (occupiedSlots > 0 && this.canGive(goodType, '0-store')) {
						relations[goodType] = {
							advertisement: 'provide',
							priority: '0-store',
						}
					}
					continue
				}

				const plannedQty =
					(this.storage.stock[goodType] ?? 0) + this.storage.allocated(goodType)
				const bufferQty = rule.minSlots * capacity

				if (plannedQty > bufferQty && this.canGive(goodType, '0-store')) {
					relations[goodType] = {
						advertisement: 'provide',
						priority: '0-store',
					}
					continue
				}

				if (plannedQty < bufferQty && this.canTake(goodType, '1-buffer')) {
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
				const plannedQty = stockQty + this.storage.allocated(goodType)
				const bufferAmount = buffers.get(goodType) || 0
				if (plannedQty > bufferAmount && this.canGive(goodType, '0-store')) {
					relations[goodType] = {
						advertisement: 'provide',
						priority: '0-store',
					}
					continue
				}
				if (plannedQty < maxAmount && plannedQty < bufferAmount) {
					relations[goodType] = {
						advertisement: 'demand',
						priority: '1-buffer',
					}
				}
			}
		}

		return relations
	}

	setSlottedGeneralSlots(generalSlots: number): void {
		const config = this.ensureSlottedStorageConfiguration()
		config.generalSlots = clampSlotCount(
			generalSlots,
			this.slottedRemainingSlotBudget(config.goods)
		)
	}

	setSlottedGoodConfiguration(
		goodType: GoodType,
		rule: Partial<Ssh.SlottedStorageGoodConfiguration> | undefined
	): void {
		const config = this.ensureSlottedStorageConfiguration()
		if (!rule) {
			delete config.goods[goodType]
			config.generalSlots = clampSlotCount(
				config.generalSlots,
				this.slottedRemainingSlotBudget(config.goods)
			)
			return
		}

		const nextMinSlots = clampSlotCount(rule.minSlots ?? 0, this.slottedAction.slots)
		if (nextMinSlots <= 0 && (rule.maxSlots ?? 0) <= 0) {
			delete config.goods[goodType]
			config.generalSlots = clampSlotCount(
				config.generalSlots,
				this.slottedRemainingSlotBudget(config.goods)
			)
			return
		}

		const currentRule = config.goods[goodType]
		config.goods[goodType] = {
			minSlots: nextMinSlots,
			maxSlots: clampSlotCount(
				rule.maxSlots ?? currentRule?.maxSlots ?? 0,
				this.slottedAction.slots
			),
		}
		this.normalizeEditableSlottedConfiguration()
	}

	removeSlottedGoodConfiguration(goodType: GoodType): void {
		const config = this.ensureSlottedStorageConfiguration()
		delete config.goods[goodType]
		config.generalSlots = clampSlotCount(
			config.generalSlots,
			this.slottedRemainingSlotBudget(config.goods)
		)
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

	private get slottedAction(): Ssh.SlottedStorageAction {
		if (this.action.type !== 'slotted-storage') {
			throw new Error(`Expected slotted-storage action, got ${this.action.type}`)
		}
		return this.action
	}

	private ensureSpecificStorageConfiguration(): Ssh.SpecificStorageAlveolusConfiguration {
		if (this.configurationRef.scope !== 'individual') {
			this.configurationRef = { scope: 'individual' }
		}
		if (
			!this.individualConfiguration ||
			!isSpecificStorageConfiguration(this.individualConfiguration)
		) {
			this.individualConfiguration = reactive({
				...(configurations['specific-storage'] as Ssh.SpecificStorageAlveolusConfiguration),
				working: this.configuration.working,
			})
		}
		return this.individualConfiguration
	}

	private ensureSlottedStorageConfiguration(): Ssh.SlottedStorageAlveolusConfiguration {
		if (this.configurationRef.scope !== 'individual') {
			this.configurationRef = { scope: 'individual' }
		}
		if (
			!this.individualConfiguration ||
			!isSlottedStorageConfiguration(this.individualConfiguration)
		) {
			this.individualConfiguration = reactive({
				working: this.configuration.working,
				generalSlots: this.slottedAction.slots,
				goods: {},
			})
		}
		this.normalizeEditableSlottedConfiguration()
		return this.individualConfiguration
	}

	private normalizeEditableSlottedConfiguration(): void {
		if (
			!this.individualConfiguration ||
			!isSlottedStorageConfiguration(this.individualConfiguration)
		)
			return

		for (const [goodType, rule] of Object.entries(this.individualConfiguration.goods)) {
			if (!rule) {
				delete this.individualConfiguration.goods[goodType]
				continue
			}
			rule.minSlots = clampSlotCount(rule.minSlots, this.slottedAction.slots)
		}

		const maxBudget = this.slottedRemainingSlotBudget(this.individualConfiguration.goods)
		for (const [goodType, rule] of Object.entries(this.individualConfiguration.goods)) {
			if (!rule) continue
			rule.maxSlots = clampSlotCount(rule.maxSlots, maxBudget)
			if (rule.minSlots <= 0 && rule.maxSlots <= 0) {
				delete this.individualConfiguration.goods[goodType]
			}
		}

		this.individualConfiguration.generalSlots = clampSlotCount(
			this.individualConfiguration.generalSlots,
			this.slottedRemainingSlotBudget(this.individualConfiguration.goods)
		)
	}

	private slottedRule(goodType: GoodType): Ssh.SlottedStorageGoodConfiguration | undefined {
		return this.slottedStorageConfiguration.goods[goodType]
	}

	private bufferedProtectedAmount(goodType: GoodType): number {
		if (this.storage instanceof SlottedStorage) {
			const rule = this.slottedRule(goodType)
			if (!rule || rule.minSlots <= 0) return 0
			const bufferQty = rule.minSlots * this.storage.maxQuantityPerSlot
			return Math.min(this.storage.available(goodType), bufferQty)
		}

		return this.buffers.get(goodType) ?? 0
	}

	private slottedCanGive(goodType: GoodType): boolean {
		if (!(this.storage instanceof SlottedStorage)) return false
		const available = this.storage.available(goodType)
		if (available <= 0) return false

		const rule = this.slottedRule(goodType)
		if (!rule || rule.minSlots <= 0) return true

		return available > rule.minSlots * this.storage.maxQuantityPerSlot
	}

	private slottedGeneralSlotUsage(slotUsage: Partial<Record<GoodType, number>>): number {
		let total = 0
		for (const [goodType, slots] of Object.entries(slotUsage) as [GoodType, number][]) {
			if (this.slottedRule(goodType)) continue
			total += slots
		}
		return total
	}

	private slottedRemainingSlotBudget(
		goods: Record<string, Ssh.SlottedStorageGoodConfiguration | undefined> = this
			.slottedStorageConfiguration.goods
	): number {
		return Math.max(0, this.slottedAction.slots - sumBufferedSlots(goods))
	}
}
