import { atomic, memoize, reactive, unreactive } from 'mutts'
import { assert } from 'ssh/src/lib/debug'
import type { Goods, GoodType } from 'ssh/src/lib/types/base'
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
	constructor(
		private storage: SlottedStorage,
		public readonly allocation: number[],
		reason: any,
	) {
		guardAllocation(this, reason)
	}

	@atomic
	cancel(): void {
		if (!isAllocationValid(this)) return
		allocationEnded(this)
		invalidateAllocation(this)
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
	}

	@atomic
	fulfill(): void {
		if (!isAllocationValid(this)) return
		allocationEnded(this)
		invalidateAllocation(this)
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
						'slot should be empty',
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
						'slot should be empty',
					)
					this.storage.slots.splice(i, 1, undefined)
				}
			}
		}
	}
}

export interface Slot {
	goodType: GoodType
	quantity: number
	allocated: number
	reserved: number
}

@reactive
export class SlottedStorage extends Storage<SlottedAllocation> {
	public readonly slots: (Slot | undefined)[] = reactive([])

	constructor(
		maxSlots: number,
		public readonly maxQuantityPerSlot: number = 1,
	) {
		super()
		for (let i = 0; i < maxSlots; i++) this.slots.push(undefined)
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
				return slot.quantity > 0 && finalQuantity < this.maxQuantityPerSlot
			})

			// Need at least 2 slots that can be defragmented
			if (defragmentableSlots.length >= 2) {
				return goodType // Return the fragmented good type
			}
		}

		return undefined
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
		let remaining = qty

		// First, try to fill existing slots with the same good type
		for (let i = 0; i < this.slots.length; i++) {
			if (remaining <= 0) break
			const slot = this.slots[i]
			if (slot && slot.goodType === goodType && slot.quantity < this.maxQuantityPerSlot) {
				const free = this.maxQuantityPerSlot - slot.quantity
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
				this.slots[i] = reactive({ goodType, quantity: canAdd, allocated: 0, reserved: 0 })
				remaining -= canAdd
			}
		}

		return qty - remaining
	}

	@atomic
	removeGood(goodType: GoodType, qty: number): number {
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
			console.warn(
				`[SlottedStorage] Cannot remove ${goodType} (qty ${qty}): remaining ${remaining}, available ${available}, stock ${stock}.`,
			)
		}

		return qty - remaining
	}

	// REHABILITATED MEMOIZE
	@memoize
	get stock(): { [k in GoodType]?: number } {
		const result: { [k in GoodType]?: number } = {}

		for (const slot of this.slots)
			if (slot?.quantity) result[slot.goodType] = (result[slot.goodType] || 0) + slot.quantity

		return result
	}

	// REHABILITATED MEMOIZE
	@memoize
	get availables(): { [k in GoodType]?: number } {
		const result: { [k in GoodType]?: number } = {}

		for (const slot of this.slots) {
			if (slot?.quantity) {
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

	allocate(goods: Goods, reason: any): SlottedAllocation {
		const alloc: number[] = Array(this.slots.length).fill(0)
		let hasAnyAllocation = false

		for (const [goodType, qty] of Object.entries(goods) as [GoodType, number][]) {
			assert(qty && qty > 0, 'qty must be set')

			let remaining = Math.min(qty, this.hasRoom(goodType))
			if (remaining <= 0) continue

			// Create list of slots with their final quantities for sorting
			const slotCandidates: { index: number; slot: Slot; finalQuantity: number }[] = []
			for (let i = 0; i < this.slots.length; i++) {
				const slot = this.slots[i]
				if (!slot || slot.goodType !== goodType) continue
				const free = this.maxQuantityPerSlot - slot.quantity - slot.allocated
				if (free <= 0) continue
				const finalQuantity = slot.quantity - slot.reserved + slot.allocated
				slotCandidates.push({ index: i, slot, finalQuantity })
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
				// Use splice to ensure reactivity triggers correctly (assignment on sparse array might be flaky)
				this.slots.splice(
					i,
					1,
					// TODO: shouldn't this be done in mutts directly?
					reactive({ goodType, quantity: 0, allocated: take, reserved: 0 }),
				)
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

		return new SlottedAllocation(this, alloc, reason)
	}

	reserve(goods: Goods, reason: any): SlottedAllocation {
		const alloc: number[] = Array(this.slots.length).fill(0)
		let hasAnyReservation = false

		for (const [goodType, qty] of Object.entries(goods) as [GoodType, number][]) {
			assert(qty, 'qty must be set')

			let remaining = Math.min(qty, this.available(goodType))
			if (remaining <= 0) continue

			// Create list of slots with their final quantities for sorting
			const slotCandidates: { index: number; slot: Slot; finalQuantity: number }[] = []
			for (let i = 0; i < this.slots.length; i++) {
				const slot = this.slots[i]
				if (!slot || slot.goodType !== goodType) continue
				const freeReservable = Math.max(0, slot.quantity - slot.reserved)
				if (freeReservable <= 0) continue
				const finalQuantity = slot.quantity - slot.reserved + slot.allocated
				slotCandidates.push({ index: i, slot, finalQuantity })
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
		for (const slot of this.slots) {
			if (!slot) continue
			slots.push({
				goodType: slot.goodType,
				present: Math.max(0, slot.quantity - slot.reserved),
				reserved: Math.max(0, slot.reserved),
				allocated: Math.max(0, slot.allocated),
				allowed: this.maxQuantityPerSlot,
			})
		}
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
