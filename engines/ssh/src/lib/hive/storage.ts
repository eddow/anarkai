import { goods as allGoodsList, configurations, jobBalance } from 'engine-rules'
import { inert, reactive } from 'mutts'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import { traces } from 'ssh/debug'
import { augmentFreightBayGoodsRelationsForConstruction } from 'ssh/freight/construction-freight-requisition'
import type { FreightStop, FreightZoneDefinitionRadius } from 'ssh/freight/freight-line'
import {
	distributeLinesAllowGoodType,
	type FreightLineDefinition,
	findDistributeFreightLines,
	findGatherFreightLines,
	gatherSegmentAllowsGoodType,
} from 'ssh/freight/freight-line'
import {
	gatherZoneLoadStopForBay,
	goodsWith,
	pickGatherTargetInZoneStop,
} from 'ssh/freight/freight-zone-gather-target'
import type { Character } from 'ssh/population/character'
import { SlottedStorage } from 'ssh/storage/slotted-storage'
import { SpecificStorage } from 'ssh/storage/specific-storage'
import type { GoodType, Job } from 'ssh/types/base'
import type { ExchangePriority, GoodsRelations } from 'ssh/utils/advertisement'
import {
	isSlottedStorageConfiguration,
	isSpecificStorageConfiguration,
} from './alveolus-configuration'
import {
	isAlveolusStorageAction,
	readSlottedStorageParams,
	readSpecificStorageParams,
	usesSlottedStorageLayout,
	usesSpecificStorageLayout,
} from './storage-action'

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
	declare action: Ssh.AlveolusStorageAction

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
		return usesSlottedStorageLayout(this.action)
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
			generalSlots: this.slottedDefinition.slots,
			goods: {},
		}
	}

	get storageBuffers(): Partial<Record<GoodType, number>> {
		if (usesSpecificStorageLayout(this.action)) {
			return this.specificStorageConfiguration.buffers
		}

		const buffers: Partial<Record<GoodType, number>> = {}
		const capacity = this.storage instanceof SlottedStorage ? this.storage.maxQuantityPerSlot : 1
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
		if (usesSpecificStorageLayout(this.action)) {
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
		const rawAction = def.action
		if (!isAlveolusStorageAction(rawAction)) {
			throw new Error(
				`StorageAlveolus created with invalid action type: ${(rawAction as Ssh.Action).type}`
			)
		}

		if (usesSlottedStorageLayout(rawAction)) {
			const { slots, capacity, buffers } = readSlottedStorageParams(rawAction)
			super(tile, new SlottedStorage(slots, capacity))

			// Legacy: if action has buffers defined, set them as individual config
			if (buffers) {
				const goods: Record<string, Ssh.SlottedStorageGoodConfiguration> = {}
				for (const [goodType, minSlots] of Object.entries(buffers)) {
					const safeMin = clampSlotCount(minSlots, slots)
					if (safeMin <= 0) continue
					goods[goodType] = {
						minSlots: safeMin,
						maxSlots: 0,
					}
				}
				this.individualConfiguration = reactive({
					working: true,
					generalSlots: slots - sumBufferedSlots(goods),
					goods,
				})
				this.normalizeEditableSlottedConfiguration()
			}
		} else if (usesSpecificStorageLayout(rawAction)) {
			const { goods, buffers } = readSpecificStorageParams(rawAction)
			super(tile, new SpecificStorage(goods))

			// Legacy: if action has buffers defined, set them as individual config
			if (buffers) {
				this.individualConfiguration = reactive({
					working: true,
					buffers: buffers,
				})
			}
		} else {
			throw new Error(`StorageAlveolus created with invalid storage layout`)
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
		if (this.action?.type === 'road-fret') {
			const freightLines = this.tile?.game?.freightLines
			if (freightLines?.length) {
				const gatherLines = findGatherFreightLines(freightLines, this)
				if (gatherLines.length > 0) {
					const distributeLines = findDistributeFreightLines(freightLines, this)
					if (
						distributeLines.length === 0 ||
						!distributeLinesAllowGoodType(distributeLines, goodType)
					) {
						return false
					}
				}
			}
		}

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

		traces.allocations?.log(`[CANTAKE] ${this.name} can take ${goodType}:`, {
			...debugInfo,
			result,
			timestamp: Date.now(),
		})

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

		traces.allocations?.log(`[CANGIVE] ${this.name} can give ${goodType}:`, {
			available,
			stock,
			bufferedProtected,
			releasable,
			working: this.working,
			priority,
			timestamp: Date.now(),
		})
		return result
	}

	get workingGoodsRelations(): GoodsRelations {
		const gatherLines = this.roadFretGatherFreightLines()
		if (gatherLines.length > 0) {
			return Object.fromEntries(
				Object.entries(this.storage.availables)
					.filter(
						([goodType, quantity]) =>
							quantity > 0 &&
							gatherLines.some((line) => gatherSegmentAllowsGoodType(line, goodType as GoodType))
					)
					.map(([goodType]) => [
						goodType as GoodType,
						{ advertisement: 'provide', priority: '2-use' as const },
					])
			)
		}

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

				const plannedQty = (this.storage.stock[goodType] ?? 0) + this.storage.allocated(goodType)
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

		const freightLines = this.tile?.game?.freightLines
		const distributeLines =
			freightLines && freightLines.length > 0 ? findDistributeFreightLines(freightLines, this) : []
		if (this.tile?.game) {
			augmentFreightBayGoodsRelationsForConstruction(this.tile.game, this, relations)
		}
		if (distributeLines.length > 0) {
			for (const goodType of Object.keys(relations) as GoodType[]) {
				if (!distributeLinesAllowGoodType(distributeLines, goodType)) delete relations[goodType]
			}
		}

		return relations
	}

	private roadFretGatherFreightLines(): FreightLineDefinition[] {
		if (this.action?.type !== 'road-fret') return []
		const freightLines = this.tile?.game?.freightLines
		if (!freightLines?.length) return []
		return findGatherFreightLines(freightLines, this)
	}

	get hasLooseGoodsToGather(): boolean {
		if (this.action?.type !== 'road-fret') return false
		const hiveNeeds = Object.keys(this.hive.needs) as GoodType[]
		for (const line of this.roadFretGatherFreightLines()) {
			const zoneStop = gatherZoneLoadStopForBay(line, this)
			if (!zoneStop) continue
			const pick = pickGatherTargetInZoneStop(
				this.tile.game,
				line,
				zoneStop as FreightStop & { zone: FreightZoneDefinitionRadius },
				this.tile.position,
				hiveNeeds,
				{
					bayAlveolus: this,
					canAcceptGood: (good) => this.storage.canStoreAll(goodsWith({}, good)),
				}
			)
			if (pick) return true
		}
		return false
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

		const nextMinSlots = clampSlotCount(rule.minSlots ?? 0, this.slottedDefinition.slots)
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
				this.slottedDefinition.slots
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
						urgency: jobBalance.defragment,
						goodType: fragmentedGoodType,
					} as Job)
				: undefined
		})
	}

	private get slottedDefinition(): { slots: number; capacity: number } {
		if (!usesSlottedStorageLayout(this.action)) {
			throw new Error(`Expected slotted storage layout, got ${this.action.type}`)
		}
		return readSlottedStorageParams(this.action)
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
				generalSlots: this.slottedDefinition.slots,
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
			rule.minSlots = clampSlotCount(rule.minSlots, this.slottedDefinition.slots)
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
		return Math.max(0, this.slottedDefinition.slots - sumBufferedSlots(goods))
	}
}
