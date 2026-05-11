import type { Goods, GoodType } from 'ssh/types/base'

export type StorageGoodsSnapshot = Readonly<Partial<Record<GoodType, number>>>

export interface SpecificStorageSnapshot {
	readonly stock: StorageGoodsSnapshot
	readonly reserved?: StorageGoodsSnapshot
	readonly allocated?: StorageGoodsSnapshot
	readonly maxAmounts: StorageGoodsSnapshot
}

export type StoragePlanResult =
	| { readonly ok: true; readonly goods: Goods }
	| { readonly ok: false; readonly reason: string }

export type SlottedStoragePlanOperation = 'allocate' | 'reserve'

export interface SlottedStoragePlanEntry {
	readonly operation: SlottedStoragePlanOperation
	readonly slotIndex: number
	readonly goodType: GoodType
	readonly quantity: number
}

export type SlottedStoragePlanResult =
	| { readonly ok: true; readonly entries: readonly SlottedStoragePlanEntry[] }
	| { readonly ok: false; readonly reason: string }

export interface SlottedStorageSlotSnapshot {
	readonly goodType: GoodType
	readonly quantity: number
	readonly allocated?: number
	readonly reserved?: number
}

export interface SlottedStorageSnapshot {
	readonly slots: readonly (SlottedStorageSlotSnapshot | undefined)[]
	readonly maxQuantityPerSlot: number
}

function positiveQuantity(value: number | undefined): number {
	return value && value > 0 ? value : 0
}

export function specificStorageAvailableGoods(snapshot: SpecificStorageSnapshot): Goods {
	const result: Goods = {}
	for (const [goodType, quantity] of Object.entries(snapshot.stock) as [GoodType, number][]) {
		const available = positiveQuantity(quantity) - positiveQuantity(snapshot.reserved?.[goodType])
		if (available > 0) result[goodType] = available
	}
	return result
}

export function specificStorageAvailable(
	snapshot: SpecificStorageSnapshot,
	goodType: GoodType
): number {
	return (
		positiveQuantity(snapshot.stock[goodType]) - positiveQuantity(snapshot.reserved?.[goodType])
	)
}

export function specificStorageRoom(snapshot: SpecificStorageSnapshot, goodType: GoodType): number {
	return (
		positiveQuantity(snapshot.maxAmounts[goodType]) -
		positiveQuantity(snapshot.stock[goodType]) -
		positiveQuantity(snapshot.allocated?.[goodType])
	)
}

export function specificStorageAllocationPlan(
	snapshot: SpecificStorageSnapshot,
	goods: StorageGoodsSnapshot
): StoragePlanResult {
	if (Object.keys(goods).length === 0) {
		return { ok: false, reason: 'Empty goods object provided for allocation' }
	}

	const actualGoods: Goods = {}
	for (const [goodType, qty] of Object.entries(goods) as [GoodType, number][]) {
		if (!qty || qty <= 0) continue
		const take = Math.min(qty, specificStorageRoom(snapshot, goodType))
		if (take > 0) actualGoods[goodType] = take
	}

	if (Object.keys(actualGoods).length === 0) {
		return { ok: false, reason: 'Insufficient room to allocate any goods' }
	}
	return { ok: true, goods: actualGoods }
}

export function specificStorageReservationPlan(
	snapshot: SpecificStorageSnapshot,
	goods: StorageGoodsSnapshot
): StoragePlanResult {
	if (Object.keys(goods).length === 0) {
		return { ok: false, reason: 'Empty goods object provided for reservation' }
	}

	const actualGoods: Goods = {}
	for (const [goodType, qty] of Object.entries(goods) as [GoodType, number][]) {
		if (!qty || qty <= 0) continue
		const take = Math.min(qty, specificStorageAvailable(snapshot, goodType))
		if (take > 0) actualGoods[goodType] = take
	}

	if (Object.keys(actualGoods).length === 0) {
		return { ok: false, reason: 'Insufficient goods to reserve any goods' }
	}
	return { ok: true, goods: actualGoods }
}

export function slottedStorageAvailableGoods(snapshot: SlottedStorageSnapshot): Goods {
	const result: Goods = {}
	for (const slot of snapshot.slots) {
		if (!slot) continue
		const available = Math.max(0, positiveQuantity(slot.quantity) - positiveQuantity(slot.reserved))
		if (available > 0) result[slot.goodType] = (result[slot.goodType] ?? 0) + available
	}
	return result
}

export function slottedStorageAvailable(
	snapshot: SlottedStorageSnapshot,
	goodType: GoodType
): number {
	let total = 0
	for (const slot of snapshot.slots) {
		if (slot?.goodType === goodType) {
			total += Math.max(0, positiveQuantity(slot.quantity) - positiveQuantity(slot.reserved))
		}
	}
	return total
}

export function slottedStorageRoom(snapshot: SlottedStorageSnapshot, goodType?: GoodType): number {
	let totalCapacity = 0
	for (const slot of snapshot.slots) {
		if (!slot) {
			totalCapacity += snapshot.maxQuantityPerSlot
			continue
		}
		if (slot.goodType !== goodType) continue
		const freeInSlot =
			snapshot.maxQuantityPerSlot -
			positiveQuantity(slot.quantity) -
			positiveQuantity(slot.allocated)
		totalCapacity += Math.max(0, freeInSlot)
	}
	return totalCapacity
}

type MutableSlotPlanState = {
	goodType: GoodType
	quantity: number
	allocated: number
	reserved: number
}

function slottedPlanState(snapshot: SlottedStorageSnapshot): (MutableSlotPlanState | undefined)[] {
	return snapshot.slots.map((slot) =>
		slot
			? {
					goodType: slot.goodType,
					quantity: positiveQuantity(slot.quantity),
					allocated: positiveQuantity(slot.allocated),
					reserved: positiveQuantity(slot.reserved),
				}
			: undefined
	)
}

export function slottedStorageAllocationPlan(
	snapshot: SlottedStorageSnapshot,
	goods: StorageGoodsSnapshot
): SlottedStoragePlanResult {
	if (Object.keys(goods).length === 0) {
		return { ok: false, reason: 'Empty goods object provided for allocation' }
	}

	const slots = slottedPlanState(snapshot)
	const entries: SlottedStoragePlanEntry[] = []

	for (const [goodType, qty] of Object.entries(goods) as [GoodType, number][]) {
		if (!qty || qty <= 0) continue

		let remaining = qty
		const slotCandidates: { index: number; finalQuantity: number }[] = []
		for (let i = 0; i < slots.length; i++) {
			const slot = slots[i]
			if (!slot || slot.goodType !== goodType) continue
			const free = snapshot.maxQuantityPerSlot - slot.quantity - slot.allocated
			if (free <= 0) continue
			const finalQuantity = slot.quantity - slot.reserved + slot.allocated
			if (finalQuantity > 0) slotCandidates.push({ index: i, finalQuantity })
		}

		slotCandidates.sort((a, b) => a.finalQuantity - b.finalQuantity)

		for (const { index } of slotCandidates) {
			if (remaining <= 0) break
			const slot = slots[index]
			if (!slot) continue
			const free = snapshot.maxQuantityPerSlot - slot.quantity - slot.allocated
			if (free <= 0) continue
			const take = Math.min(remaining, free)
			slot.allocated += take
			entries.push({ operation: 'allocate', slotIndex: index, goodType, quantity: take })
			remaining -= take
		}

		for (let i = 0; i < slots.length && remaining > 0; i++) {
			if (slots[i] !== undefined) continue
			const take = Math.min(remaining, snapshot.maxQuantityPerSlot)
			slots[i] = { goodType, quantity: 0, allocated: take, reserved: 0 }
			entries.push({ operation: 'allocate', slotIndex: i, goodType, quantity: take })
			remaining -= take
		}
	}

	if (entries.length === 0) {
		return { ok: false, reason: 'Insufficient room to allocate any goods' }
	}
	return { ok: true, entries }
}

export function slottedStorageReservationPlan(
	snapshot: SlottedStorageSnapshot,
	goods: StorageGoodsSnapshot
): SlottedStoragePlanResult {
	if (Object.keys(goods).length === 0) {
		return { ok: false, reason: 'Empty goods object provided for reservation' }
	}

	const slots = slottedPlanState(snapshot)
	const entries: SlottedStoragePlanEntry[] = []

	for (const [goodType, qty] of Object.entries(goods) as [GoodType, number][]) {
		if (!qty || qty <= 0) continue

		let remaining = qty
		const slotCandidates: { index: number; finalQuantity: number }[] = []
		for (let i = 0; i < slots.length; i++) {
			const slot = slots[i]
			if (!slot || slot.goodType !== goodType) continue
			const freeReservable = Math.max(0, slot.quantity - slot.reserved)
			if (freeReservable <= 0) continue
			const finalQuantity = slot.quantity - slot.reserved + slot.allocated
			if (finalQuantity > 0) slotCandidates.push({ index: i, finalQuantity })
		}

		slotCandidates.sort((a, b) => b.finalQuantity - a.finalQuantity)

		for (const { index } of slotCandidates) {
			if (remaining <= 0) break
			const slot = slots[index]
			if (!slot) continue
			const freeReservable = Math.max(0, slot.quantity - slot.reserved)
			if (freeReservable <= 0) continue
			const take = Math.min(remaining, freeReservable)
			slot.reserved += take
			entries.push({ operation: 'reserve', slotIndex: index, goodType, quantity: take })
			remaining -= take
		}
	}

	if (entries.length === 0) {
		return { ok: false, reason: 'Insufficient goods to reserve any goods' }
	}
	return { ok: true, entries }
}
