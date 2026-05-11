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
