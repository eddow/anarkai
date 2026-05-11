import { atomic, memoize, reactive } from 'mutts'
import type { Commitment, FailureReason } from 'ssh/commitment'
import { type Goods, GoodType } from 'ssh/types/base'
import { assert, traces } from '../dev/debug.ts'
import {
	type SlottedStorageSnapshot,
	slottedStorageAllocationPlan,
	slottedStorageAvailable,
	slottedStorageAvailableGoods,
	slottedStorageReservationPlan,
	slottedStorageRoom,
} from './pure'
import { Storage } from './storage'
import type { RenderedGoodSlot, RenderedGoodSlots } from './types'

export interface Slot {
	goodType: GoodType
	quantity: number
	allocated: number
	reserved: number
}

@reactive
class SlotImpl implements Slot {
	goodType: GoodType
	quantity: number
	allocated = 0
	reserved = 0
	constructor(goodType: GoodType, quantity: number) {
		this.goodType = goodType
		this.quantity = quantity
	}
}

function makeSlot(goodType: GoodType, quantity: number): Slot {
	return reactive(new SlotImpl(goodType, quantity))
}

@reactive
export class SlottedStorage extends Storage {
	public readonly slots: (Slot | undefined)[] = reactive([])

	constructor(
		maxSlots: number,
		public readonly maxQuantityPerSlot: number = 1
	) {
		super()
		for (let i = 0; i < maxSlots; i++) this.slots.push(undefined)
	}

	assertIntegrity(label: string): void {
		const stockTotals: Partial<Record<GoodType, number>> = {}
		const availableTotals: Partial<Record<GoodType, number>> = {}
		const allocatedTotals: Partial<Record<GoodType, number>> = {}

		for (let i = 0; i < this.slots.length; i++) {
			const slot = this.slots[i]
			if (!slot) continue
			assert(GoodType.allows(slot.goodType), `${label}: invalid good type at slot ${i}`)
			assert(Number.isFinite(slot.quantity), `${label}: slot ${i} quantity must be finite`)
			assert(Number.isFinite(slot.allocated), `${label}: slot ${i} allocated must be finite`)
			assert(Number.isFinite(slot.reserved), `${label}: slot ${i} reserved must be finite`)
			assert(slot.quantity >= 0, `${label}: slot ${i} quantity must be >= 0`)
			assert(slot.allocated >= 0, `${label}: slot ${i} allocated must be >= 0`)
			assert(slot.reserved >= 0, `${label}: slot ${i} reserved must be >= 0`)
			assert(slot.reserved <= slot.quantity, `${label}: slot ${i} reserved exceeds quantity`)
			assert(
				slot.quantity <= this.maxQuantityPerSlot,
				`${label}: slot ${i} quantity exceeds slot max`
			)
			assert(
				slot.quantity + slot.allocated <= this.maxQuantityPerSlot,
				`${label}: slot ${i} quantity+allocated exceeds slot max`
			)
			assert(slot.quantity + slot.allocated > 0, `${label}: slot ${i} is empty but still present`)

			stockTotals[slot.goodType] = (stockTotals[slot.goodType] ?? 0) + slot.quantity
			availableTotals[slot.goodType] =
				(availableTotals[slot.goodType] ?? 0) + Math.max(0, slot.quantity - slot.reserved)
			allocatedTotals[slot.goodType] = (allocatedTotals[slot.goodType] ?? 0) + slot.allocated
		}

		for (const goodType of Object.keys(stockTotals) as GoodType[]) {
			assert(
				(stockTotals[goodType] ?? 0) === (this.stock[goodType] ?? 0),
				`${label}: stock mismatch for ${goodType}`
			)
			assert(
				(availableTotals[goodType] ?? 0) === this.available(goodType),
				`${label}: available mismatch for ${goodType}`
			)
			assert(
				(allocatedTotals[goodType] ?? 0) === this.allocated(goodType),
				`${label}: allocated mismatch for ${goodType}`
			)
		}
	}

	get allocatedSlots(): boolean {
		return this.slots.some((slot) => slot?.allocated)
	}

	@memoize
	get fragmented(): GoodType | undefined {
		// Group slots by good type and check for fragmentation
		const slotsByGoodType = new Map<GoodType, Slot[]>()

		for (const slot of this.slots) {
			if (!slot) continue
			if (!slotsByGoodType.has(slot.goodType)) {
				slotsByGoodType.set(slot.goodType, [])
			}
			slotsByGoodType.get(slot.goodType)!.push(slot)
		}

		// Check if any good type has multiple slots that can be defragmented
		for (const [goodType, slots] of slotsByGoodType) {
			if (slots.length < 2) continue // Need at least 2 slots to be fragmented

			// Count slots that have quantity > 0 and final quantity < maximum
			const defragmentableSlots = slots.filter((slot) => {
				const finalQuantity = slot.quantity - slot.reserved + slot.allocated
				return slot.quantity > 0 && finalQuantity > 0 && finalQuantity < this.maxQuantityPerSlot
			})

			// Need at least 2 slots that can be defragmented
			if (defragmentableSlots.length >= 2) {
				return goodType // Return the fragmented good type
			}
		}

		return undefined
	}

	/**
	 * Merge multiple non-pending slots of the same good type into fewer slots (pack by addGood).
	 */
	@atomic
	compactIdleSameGoodTypeSlots(): void {
		this.assertIntegrity('SlottedStorage.compactIdleSameGoodTypeSlots.before')
		const byType = new Map<GoodType, number[]>()
		for (let i = 0; i < this.slots.length; i++) {
			const s = this.slots[i]
			if (!s || s.allocated !== 0 || s.reserved !== 0) continue
			const list = byType.get(s.goodType) ?? []
			list.push(i)
			byType.set(s.goodType, list)
		}
		for (const [goodType, indices] of byType) {
			if (indices.length < 2) continue
			let total = 0
			for (const i of indices) {
				const s = this.slots[i]
				if (s?.goodType === goodType) total += s.quantity
			}
			if (total <= 0) continue
			indices.sort((a, b) => b - a)
			for (const i of indices) {
				this.slots.splice(i, 1, undefined)
			}
			this.addGood(goodType, total)
		}
		this.assertIntegrity('SlottedStorage.compactIdleSameGoodTypeSlots.after')
	}

	get usedSlots(): number {
		return this.slots.reduce((count, slot) => count + (slot ? 1 : 0), 0)
	}

	get emptySlots(): number {
		return this.slots.length - this.usedSlots
	}

	occupiedSlots(goodType: GoodType): number {
		let total = 0
		for (const slot of this.slots) {
			if (slot?.goodType === goodType) total++
		}
		return total
	}

	slotUsage(): Partial<Record<GoodType, number>> {
		const usage: Partial<Record<GoodType, number>> = {}
		for (const slot of this.slots) {
			if (!slot) continue
			usage[slot.goodType] = (usage[slot.goodType] ?? 0) + 1
		}
		return usage
	}

	hasPartialRoomFor(goodType: GoodType): boolean {
		return this.slots.some(
			(slot) =>
				!!slot &&
				slot.goodType === goodType &&
				slot.quantity + slot.allocated < this.maxQuantityPerSlot
		)
	}

	hasRoom(goodType?: GoodType): number {
		return slottedStorageRoom(this.snapshot(), goodType)
	}

	get isEmpty(): boolean {
		return this.slots.every((slot) => slot === undefined || slot.quantity === 0)
	}
	@atomic
	addGood(goodType: GoodType, qty: number): number {
		this.assertIntegrity('SlottedStorage.addGood.before')
		let remaining = qty

		// First, try to fill existing slots with the same good type
		for (let i = 0; i < this.slots.length; i++) {
			if (remaining <= 0) break
			const slot = this.slots[i]
			if (
				slot &&
				slot.goodType === goodType &&
				slot.quantity + slot.allocated < this.maxQuantityPerSlot
			) {
				const free = this.maxQuantityPerSlot - slot.quantity - slot.allocated
				const canAdd = Math.min(remaining, free)
				slot.quantity += canAdd
				remaining -= canAdd
			}
		}

		// Then, try to fill empty slots
		for (let i = 0; i < this.slots.length; i++) {
			if (remaining <= 0) break
			if (this.slots[i] === undefined) {
				const canAdd = Math.min(remaining, this.maxQuantityPerSlot)
				this.slots[i] = makeSlot(goodType, canAdd)
				remaining -= canAdd
			}
		}

		const stored = qty - remaining
		this.assertIntegrity('SlottedStorage.addGood.after')
		if (stored > 0) {
			this.notifyPresentationChanged('stock')
			this.notifyGameplayChanged('stock')
			this.notifyPlanningChanged('stock')
		}
		return stored
	}

	@atomic
	removeGood(goodType: GoodType, qty: number): number {
		this.assertIntegrity('SlottedStorage.removeGood.before')
		let remaining = qty

		// Remove from slots containing this good type
		for (let i = 0; i < this.slots.length; i++) {
			if (remaining <= 0) break
			const slot = this.slots[i]
			if (slot && slot.goodType === goodType) {
				const canRemove = Math.min(remaining, Math.max(0, slot.quantity - slot.reserved))
				slot.quantity -= canRemove
				remaining -= canRemove

				// Clear slot if empty
				if (slot.quantity + slot.allocated === 0) {
					this.slots.splice(i, 1, undefined)
				}
			}
		}

		if (remaining > 0 && qty > 0) {
			const available = this.available(goodType)
			const stock = this.stock[goodType] ?? 0
			traces.allocations.warn?.(
				`[SlottedStorage] Cannot remove ${goodType} (qty ${qty}): remaining ${remaining}, available ${available}, stock ${stock}.`
			)
		}

		const removed = qty - remaining
		this.assertIntegrity('SlottedStorage.removeGood.after')
		if (removed > 0) {
			this.notifyPresentationChanged('stock')
			this.notifyGameplayChanged('stock')
			this.notifyPlanningChanged('stock')
		}
		return removed
	}

	get stock(): { [k in GoodType]?: number } {
		const result: { [k in GoodType]?: number } = {}

		for (const slot of this.slots)
			if (slot && slot.quantity > 0)
				result[slot.goodType] = (result[slot.goodType] || 0) + slot.quantity

		return result
	}

	get availables(): { [k in GoodType]?: number } {
		return slottedStorageAvailableGoods(this.snapshot())
	}

	available(goodType: GoodType): number {
		return slottedStorageAvailable(this.snapshot(), goodType)
	}

	allocated(goodType: GoodType): number {
		let total = 0
		for (const slot of this.slots) {
			if (slot?.goodType === goodType) total += slot.allocated
		}
		return total
	}

	get virtualGoodsCount(): number {
		let total = 0
		for (const slot of this.slots) {
			if (!slot) continue
			total += slot.reserved + slot.allocated
		}
		return total
	}

	/**
	 * Allocate room for goods and register lifecycle callbacks on the commitment.
	 * @returns `undefined` on success, a string reason on failure.
	 */
	allocate(goods: Goods, commitment: Commitment): FailureReason {
		this.assertIntegrity('SlottedStorage.allocate.before')
		for (const [, qty] of Object.entries(goods) as [GoodType, number][]) {
			assert(qty && qty > 0, 'qty must be set')
		}
		const plan = slottedStorageAllocationPlan(this.snapshot(), goods)
		if (!plan.ok) return plan.reason

		for (const entry of plan.entries) {
			assert(entry.operation === 'allocate', 'allocation plan contained non-allocation entry')
			const slot = this.slots[entry.slotIndex]
			if (slot) {
				assert(slot.goodType === entry.goodType, 'allocation plan good type mismatch')
				slot.allocated += entry.quantity
			} else {
				const newSlot = makeSlot(entry.goodType, 0)
				newSlot.allocated = entry.quantity
				this.slots.splice(entry.slotIndex, 1, newSlot)
			}
		}

		// Register lifecycle callbacks on the commitment
		commitment.onFulfilled(() => {
			this.assertIntegrity('SlottedStorage.allocate.fulfill.before')
			for (const entry of plan.entries) {
				const slot = this.slots[entry.slotIndex]
				assert(!!slot, 'fulfill: slot missing for allocated entry')
				assert(slot.goodType === entry.goodType, 'fulfill: allocated slot good type mismatch')
				assert(slot.allocated >= entry.quantity, 'fulfill: allocated less than fulfill amount')
				const roomHere = this.maxQuantityPerSlot - slot.quantity
				assert(roomHere >= entry.quantity, 'fulfill: not enough room in slot')
				slot.quantity += entry.quantity
				slot.allocated -= entry.quantity
				if (slot.quantity + slot.allocated === 0) {
					assert(
						slot.reserved === 0 && slot.allocated === 0 && slot.quantity === 0,
						'slot should be empty'
					)
					this.slots.splice(entry.slotIndex, 1, undefined)
				}
			}
			this.compactIdleSameGoodTypeSlots()
			this.assertIntegrity('SlottedStorage.allocate.fulfill.after')
			this.notifyPresentationChanged('stock')
			this.notifyGameplayChanged('stock')
			this.notifyPlanningChanged('stock')
		})

		commitment.onCancelled(() => {
			this.assertIntegrity('SlottedStorage.allocate.cancel.before')
			for (const entry of plan.entries) {
				const slot = this.slots[entry.slotIndex]
				assert(!!slot, 'cancel: slot missing for allocated entry')
				assert(slot.goodType === entry.goodType, 'cancel: allocated slot good type mismatch')
				assert(slot.allocated >= entry.quantity, 'cancel: allocated less than cancel amount')
				slot.allocated -= entry.quantity
				if (slot.quantity + slot.allocated === 0) this.slots.splice(entry.slotIndex, 1, undefined)
			}
			this.compactIdleSameGoodTypeSlots()
			this.assertIntegrity('SlottedStorage.allocate.cancel.after')
			this.notifyPresentationChanged('allocation')
			this.notifyPlanningChanged('allocation')
		})

		this.assertIntegrity('SlottedStorage.allocate.after')
		this.notifyPresentationChanged('allocation')
		this.notifyPlanningChanged('allocation')
		return undefined
	}

	/**
	 * Reserve existing goods for removal and register lifecycle callbacks on the commitment.
	 * @returns `undefined` on success, a string reason on failure.
	 */
	reserve(goods: Goods, commitment: Commitment): FailureReason {
		this.assertIntegrity('SlottedStorage.reserve.before')
		for (const [, qty] of Object.entries(goods) as [GoodType, number][]) {
			assert(qty && qty > 0, 'qty must be set')
		}
		const plan = slottedStorageReservationPlan(this.snapshot(), goods)
		if (!plan.ok) return plan.reason

		for (const entry of plan.entries) {
			assert(entry.operation === 'reserve', 'reservation plan contained non-reservation entry')
			const slot = this.slots[entry.slotIndex]
			assert(!!slot, 'reservation plan slot missing')
			assert(slot.goodType === entry.goodType, 'reservation plan good type mismatch')
			slot.reserved += entry.quantity
		}

		// Register lifecycle callbacks on the commitment
		commitment.onFulfilled(() => {
			this.assertIntegrity('SlottedStorage.reserve.fulfill.before')
			for (const entry of plan.entries) {
				const slot = this.slots[entry.slotIndex]
				assert(!!slot, 'fulfill: slot missing for reserved entry')
				assert(slot.goodType === entry.goodType, 'fulfill: reserved slot good type mismatch')
				const want = entry.quantity
				assert(slot.reserved >= want, 'fulfill: reserved less than fulfill amount')
				assert(slot.quantity >= want, 'fulfill: quantity less than fulfill amount')
				slot.quantity -= want
				slot.reserved -= want
				if (slot.quantity + slot.allocated === 0) {
					assert(
						slot.reserved === 0 && slot.allocated === 0 && slot.quantity === 0,
						'slot should be empty'
					)
					this.slots.splice(entry.slotIndex, 1, undefined)
				}
			}
			this.compactIdleSameGoodTypeSlots()
			this.assertIntegrity('SlottedStorage.reserve.fulfill.after')
			this.notifyPresentationChanged('stock')
			this.notifyGameplayChanged('stock')
			this.notifyPlanningChanged('stock')
		})

		commitment.onCancelled(() => {
			this.assertIntegrity('SlottedStorage.reserve.cancel.before')
			for (const entry of plan.entries) {
				const slot = this.slots[entry.slotIndex]
				assert(!!slot, 'cancel: slot missing for reserved entry')
				assert(slot.goodType === entry.goodType, 'cancel: reserved slot good type mismatch')
				const need = entry.quantity
				assert(slot.reserved >= need, 'cancel: reserved less than cancel amount')
				slot.reserved -= need
				// quantity unchanged on cancel of negative allocation
				if (slot.quantity + slot.allocated === 0) this.slots[entry.slotIndex] = undefined
			}
			this.compactIdleSameGoodTypeSlots()
			this.assertIntegrity('SlottedStorage.reserve.cancel.after')
			this.notifyPresentationChanged('reservation')
			this.notifyPlanningChanged('reservation')
		})

		this.assertIntegrity('SlottedStorage.reserve.after')
		this.notifyPresentationChanged('reservation')
		this.notifyPlanningChanged('reservation')
		return undefined
	}

	canStoreAll(goods: Goods): boolean {
		// Prepare remaining requirements per good type
		const remaining: { [k: string]: number } = {}
		for (const [t, q] of Object.entries(goods)) {
			if (!q || q <= 0) continue
			remaining[t] = q
		}

		// Try to fit into existing slots of the same type first; count empty slots
		let emptySlots = 0
		for (const slot of this.slots) {
			if (!slot) {
				emptySlots++
				continue
			}
			const key = String(slot.goodType)
			const need = remaining[key] || 0
			if (need <= 0) continue
			const freeHere = Math.max(0, this.maxQuantityPerSlot - slot.quantity - slot.allocated)
			if (freeHere <= 0) continue
			const used = Math.min(need, freeHere)
			remaining[key] = need - used
		}

		const slotsNeeded = Object.values(remaining)
			.map((q) => Math.ceil(q / this.maxQuantityPerSlot))
			.reduce((acc, q) => acc + q, 0)
		return slotsNeeded <= emptySlots
	}

	// presentAmount replaced by available()
	renderedGoods(): RenderedGoodSlots {
		const slots: RenderedGoodSlot[] = []
		let anyContent = false
		for (let i = 0; i < this.slots.length; i++) {
			const slot = this.slots[i]
			if (!slot) {
				slots.push({
					present: 0,
					reserved: 0,
					allocated: 0,
					allowed: this.maxQuantityPerSlot,
				})
				continue
			}
			const present = Math.max(0, slot.quantity - slot.reserved)
			const reserved = Math.max(0, slot.reserved)
			const allocated = Math.max(0, slot.allocated)
			if (present || reserved || allocated) anyContent = true
			slots.push({
				goodType: slot.goodType,
				present,
				reserved,
				allocated,
				allowed: this.maxQuantityPerSlot,
			})
		}
		if (!anyContent) return { slots: [] }
		return { slots, assumedMaxSlots: this.slots.length }
	}

	get debugInfo(): Record<string, any> {
		return {
			type: 'SlottedStorage',
			maxSlots: this.slots.length,
			maxQuantityPerSlot: this.maxQuantityPerSlot,
			slots: this.slots.map((slot, index) => ({
				index,
				goodType: slot?.goodType,
				quantity: slot?.quantity || 0,
				allocated: slot?.allocated || 0,
				reserved: slot?.reserved || 0,
			})),
		}
	}

	private snapshot(): SlottedStorageSnapshot {
		return {
			slots: this.slots,
			maxQuantityPerSlot: this.maxQuantityPerSlot,
		}
	}
}
