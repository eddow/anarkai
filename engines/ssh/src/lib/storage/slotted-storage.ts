import { atomic, memoize, reactive } from 'mutts'
import { assert } from 'ssh/debug'
import { traces } from 'ssh/debug'
import { type Goods, GoodType } from 'ssh/types/base'
import {
	AllocationError,
	allocationEnded,
	guardAllocation,
	invalidateAllocation,
	isAllocationValid,
} from './guard'
import { type AllocationBase, Storage } from './storage'
import type { RenderedGoodSlot, RenderedGoodSlots } from './types'

@reactive
class SlottedAllocation implements AllocationBase {
	public readonly reason: unknown
	constructor(
		private storage: SlottedStorage,
		public readonly allocation: number[],
		reason: unknown
	) {
		this.reason = reason
		guardAllocation(this, reason)
	}

	@atomic
	cancel(): void {
		if (!isAllocationValid(this)) return
		this.storage.assertIntegrity('SlottedAllocation.cancel.before')
		allocationEnded(this)
		invalidateAllocation(this, 'SlottedAllocation.cancel')
		for (let i = 0; i < this.allocation.length; i++) {
			const amount = this.allocation[i]
			if (amount === 0) continue
			const slot = this.storage.slots[i]
			assert(!!slot, 'cancel: slot missing for allocated/reserved entry')
			if (amount > 0) {
				// Ensure the allocation exists
				assert(slot.allocated >= amount, 'cancel: allocated less than cancel amount')
				slot.allocated -= amount
				if (slot.quantity + slot.allocated === 0) this.storage.slots.splice(i, 1, undefined)
			} else {
				const need = -amount
				assert(slot.reserved >= need, 'cancel: reserved less than cancel amount')
				slot.reserved -= need
				// quantity unchanged on cancel of negative allocation
				if (slot.quantity + slot.allocated === 0) this.storage.slots[i] = undefined
			}
		}
		this.storage.compactIdleSameGoodTypeSlots()
		this.storage.assertIntegrity('SlottedAllocation.cancel.after')
	}

	@atomic
	fulfill(): void {
		if (!isAllocationValid(this)) return
		this.storage.assertIntegrity('SlottedAllocation.fulfill.before')
		allocationEnded(this)
		invalidateAllocation(this, 'SlottedAllocation.fulfill')
		for (let i = 0; i < this.allocation.length; i++) {
			const amount = this.allocation[i]
			if (amount === 0) continue
			const slot = this.storage.slots[i]
			assert(!!slot, 'fulfill: slot missing for allocated/reserved entry')
			if (amount > 0) {
				// Positive amount means allocate->present
				assert(slot.allocated >= amount, 'fulfill: allocated less than fulfill amount')
				const roomHere = this.storage.maxQuantityPerSlot - slot.quantity
				assert(roomHere >= amount, 'fulfill: not enough room in slot')
				slot.quantity += amount
				slot.allocated -= amount
				if (slot.quantity + slot.allocated === 0) {
					assert(
						slot.reserved === 0 && slot.allocated === 0 && slot.quantity === 0,
						'slot should be empty'
					)
					this.storage.slots.splice(i, 1, undefined)
				}
			} else {
				const want = -amount
				assert(slot.reserved >= want, 'fulfill: reserved less than fulfill amount')
				assert(slot.quantity >= want, 'fulfill: quantity less than fulfill amount')
				slot.quantity -= want
				slot.reserved -= want
				if (slot.quantity + slot.allocated === 0) {
					assert(
						slot.reserved === 0 && slot.allocated === 0 && slot.quantity === 0,
						'slot should be empty'
					)
					this.storage.slots.splice(i, 1, undefined)
				}
			}
		}
		this.storage.compactIdleSameGoodTypeSlots()
		this.storage.assertIntegrity('SlottedAllocation.fulfill.after')
	}
}

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
export class SlottedStorage extends Storage<SlottedAllocation> {
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
			assert(slot.quantity <= this.maxQuantityPerSlot, `${label}: slot ${i} quantity exceeds slot max`)
			assert(
				slot.quantity + slot.allocated <= this.maxQuantityPerSlot,
				`${label}: slot ${i} quantity+allocated exceeds slot max`
			)
			assert(
				slot.quantity + slot.allocated > 0,
				`${label}: slot ${i} is empty but still present`
			)

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
		let totalCapacity = 0
		for (const slot of this.slots) {
			if (!slot) {
				totalCapacity += this.maxQuantityPerSlot
				continue
			}
			if (slot.goodType === goodType) {
				const freeInSlot = this.maxQuantityPerSlot - slot.quantity - slot.allocated
				totalCapacity += Math.max(0, freeInSlot)
			}
		}
		return totalCapacity
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
			traces.allocations?.warn?.(
				`[SlottedStorage] Cannot remove ${goodType} (qty ${qty}): remaining ${remaining}, available ${available}, stock ${stock}.`
			)
		}

		const removed = qty - remaining
		this.assertIntegrity('SlottedStorage.removeGood.after')
		return removed
	}

	get stock(): { [k in GoodType]?: number } {
		const result: { [k in GoodType]?: number } = {}

		for (const slot of this.slots)
			if (slot && slot.quantity > 0)
				result[slot.goodType] = (result[slot.goodType] || 0) + slot.quantity

		return result
	}

	// TODO: @memoize
	get availables(): { [k in GoodType]?: number } {
		const result: { [k in GoodType]?: number } = {}

		for (const slot of this.slots) {
			if (!slot) continue
			if (slot.quantity > 0) {
				const available = Math.max(0, slot.quantity - slot.reserved)
				if (available > 0) {
					result[slot.goodType] = (result[slot.goodType] || 0) + available
				}
			}
		}

		return result
	}

	available(goodType: GoodType): number {
		let total = 0
		for (const slot of this.slots) {
			if (slot?.goodType === goodType) total += Math.max(0, slot.quantity - slot.reserved)
		}
		return total
	}

	allocated(goodType: GoodType): number {
		let total = 0
		for (const slot of this.slots) {
			if (slot?.goodType === goodType) total += slot.allocated
		}
		return total
	}

	allocate(goods: Goods, reason: any): SlottedAllocation {
		this.assertIntegrity('SlottedStorage.allocate.before')
		const alloc: number[] = Array(this.slots.length).fill(0)
		let hasAnyAllocation = false

		for (const [goodType, qty] of Object.entries(goods) as [GoodType, number][]) {
			assert(qty && qty > 0, 'qty must be set')

			let remaining = Math.min(qty, this.hasRoom(goodType))
			if (remaining <= 0) continue

			// Create list of slots with their final quantities for sorting
			const slotCandidates: {
				index: number
				slot: Slot
				finalQuantity: number
			}[] = []
			for (let i = 0; i < this.slots.length; i++) {
				const slot = this.slots[i]
				if (!slot || slot.goodType !== goodType) continue
				const free = this.maxQuantityPerSlot - slot.quantity - slot.allocated
				if (free <= 0) continue
				const finalQuantity = slot.quantity - slot.reserved + slot.allocated
				if (finalQuantity > 0) slotCandidates.push({ index: i, slot, finalQuantity })
			}

			// Sort by final quantity (lowest first) for allocation
			slotCandidates.sort((a, b) => a.finalQuantity - b.finalQuantity)

			// Allocate in existing slots (sorted by lowest final quantity)
			for (const { index, slot } of slotCandidates) {
				if (remaining <= 0) break
				const free = this.maxQuantityPerSlot - slot.quantity - slot.allocated
				if (free <= 0) continue
				const take = Math.min(remaining, free)
				slot.allocated += take
				alloc[index] += take
				remaining -= take
			}

			// Allocate in empty slots
			for (let i = 0; i < this.slots.length && remaining > 0; i++) {
				if (this.slots[i] !== undefined) continue
				const take = Math.min(remaining, this.maxQuantityPerSlot)
				const newSlot = makeSlot(goodType, 0)
				newSlot.allocated = take
				// Use splice to ensure reactivity triggers correctly (assignment on sparse array might be flaky)
				this.slots.splice(i, 1, newSlot)
				alloc[i] += take
				remaining -= take
			}

			if (qty - remaining > 0) hasAnyAllocation = true
		}

		if (!hasAnyAllocation && Object.keys(goods).length > 0) {
			throw new AllocationError(`Insufficient room to allocate any goods`, reason)
		}

		if (Object.keys(goods).length === 0) {
			throw new AllocationError(`Empty goods object provided for allocation`, reason)
		}

		this.assertIntegrity('SlottedStorage.allocate.after')
		return new SlottedAllocation(this, alloc, reason)
	}

	reserve(goods: Goods, reason: any): SlottedAllocation {
		this.assertIntegrity('SlottedStorage.reserve.before')
		const alloc: number[] = Array(this.slots.length).fill(0)
		let hasAnyReservation = false

		for (const [goodType, qty] of Object.entries(goods) as [GoodType, number][]) {
			assert(qty, 'qty must be set')

			let remaining = Math.min(qty, this.available(goodType))
			if (remaining <= 0) continue

			// Create list of slots with their final quantities for sorting
			const slotCandidates: {
				index: number
				slot: Slot
				finalQuantity: number
			}[] = []
			for (let i = 0; i < this.slots.length; i++) {
				const slot = this.slots[i]
				if (!slot || slot.goodType !== goodType) continue
				const freeReservable = Math.max(0, slot.quantity - slot.reserved)
				if (freeReservable <= 0) continue
				const finalQuantity = slot.quantity - slot.reserved + slot.allocated
				if (finalQuantity > 0) slotCandidates.push({ index: i, slot, finalQuantity })
			}

			// Sort by final quantity (highest first) for reservation
			slotCandidates.sort((a, b) => b.finalQuantity - a.finalQuantity)

			// Reserve goods that are present but not yet reserved (sorted by highest final quantity)
			for (const { index, slot } of slotCandidates) {
				if (remaining <= 0) break
				const freeReservable = Math.max(0, slot.quantity - slot.reserved)
				if (freeReservable <= 0) continue
				const take = Math.min(remaining, freeReservable)
				slot.reserved += take
				alloc[index] -= take // negative marks reservation
				remaining -= take
			}

			if (qty - remaining > 0) hasAnyReservation = true
		}

		if (!hasAnyReservation) {
			throw new AllocationError(`Insufficient goods to reserve any goods`, reason)
		}

		this.assertIntegrity('SlottedStorage.reserve.after')
		return new SlottedAllocation(this, alloc, reason)
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
}
