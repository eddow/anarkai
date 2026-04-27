import { atomic, memoize, reactive } from 'mutts'
import type { Goods } from 'ssh/types/base'
import { GoodType } from 'ssh/types/base'
import { assert, traces } from '../dev/debug.ts'
import type { RenderedGoodSlots } from '.'
import {
	AllocationError,
	allocationEnded,
	guardAllocation,
	invalidateAllocation,
	isAllocationValid,
} from './guard'
import { type AllocationBase, Storage } from './storage'
import type { RenderedGoodSlot } from './types'

@reactive
class SpecificAllocation implements AllocationBase {
	public readonly reason: unknown
	constructor(
		private storage: SpecificStorage,
		public readonly goods: Goods,
		reason: unknown
	) {
		this.reason = reason
		guardAllocation(this, reason)
	}

	@atomic
	cancel(): void {
		if (!isAllocationValid(this)) return
		this.storage.assertIntegrity('SpecificAllocation.cancel.before')
		allocationEnded(this)
		invalidateAllocation(this, 'SpecificAllocation.cancel')

		for (const [goodType, qty] of Object.entries(this.goods) as [GoodType, number][]) {
			assert(qty, 'qty must be set')

			if (qty > 0) {
				const curAlloc = this.storage._allocated[goodType] || 0
				assert(curAlloc >= qty, 'cancel: allocated less than cancel qty')
				this.storage._allocated[goodType] = curAlloc - qty
			} else if (qty < 0) {
				const curRes = this.storage._reserved[goodType] || 0
				assert(curRes >= -qty, 'cancel: reserved less than cancel qty')
				this.storage._reserved[goodType] = curRes + qty
			}
		}
		this.storage.assertIntegrity('SpecificAllocation.cancel.after')
	}

	@atomic
	fulfill(): void {
		if (!isAllocationValid(this)) return
		this.storage.assertIntegrity('SpecificAllocation.fulfill.before')
		allocationEnded(this)
		invalidateAllocation(this, 'SpecificAllocation.fulfill')

		for (const [goodType, qty] of Object.entries(this.goods) as [GoodType, number][]) {
			assert(qty, 'qty must be set')

			if (qty > 0) {
				const curAlloc = this.storage._allocated[goodType] || 0
				assert(curAlloc >= qty, 'fulfill: allocated less than fulfill qty')
				this.storage._allocated[goodType] = curAlloc - qty
				this.storage._goods[goodType] = (this.storage._goods[goodType] || 0) + qty
			} else if (qty < 0) {
				const want = -qty
				const curRes = this.storage._reserved[goodType] || 0
				const have = this.storage._goods[goodType] || 0
				assert(curRes >= want, 'fulfill: reserved less than fulfill qty')
				assert(have >= want, 'fulfill: goods less than fulfill qty')
				this.storage._reserved[goodType] = curRes - want
				this.storage._goods[goodType] = have - want
			}
		}
		this.storage.assertIntegrity('SpecificAllocation.fulfill.after')
	}
}

@reactive
export class SpecificStorage extends Storage<SpecificAllocation> {
	public readonly _goods: { [k in GoodType]?: number }
	public readonly _allocated: { [k in GoodType]?: number }
	public readonly _reserved: { [k in GoodType]?: number }
	public readonly maxAmounts: { [k in GoodType]?: number }

	constructor(maxAmounts: Ssh.SpecificStorage) {
		super()
		this._goods = reactive({})
		this._allocated = reactive({})
		this._reserved = reactive({})
		this.maxAmounts = reactive({ ...maxAmounts })
	}

	assertIntegrity(label: string): void {
		const goodTypes = new Set<GoodType>([
			...(Object.keys(this.maxAmounts) as GoodType[]),
			...(Object.keys(this._goods) as GoodType[]),
			...(Object.keys(this._allocated) as GoodType[]),
			...(Object.keys(this._reserved) as GoodType[]),
		])
		for (const goodType of goodTypes) {
			assert(GoodType.allows(goodType), `${label}: invalid good type ${goodType}`)
			const goods = this._goods[goodType] || 0
			const allocated = this._allocated[goodType] || 0
			const reserved = this._reserved[goodType] || 0
			const maxAmount = this.maxAmounts[goodType] || 0
			assert(goods >= 0, `${label}: goods for ${goodType} must be >= 0`)
			assert(allocated >= 0, `${label}: allocated for ${goodType} must be >= 0`)
			assert(reserved >= 0, `${label}: reserved for ${goodType} must be >= 0`)
			assert(reserved <= goods, `${label}: reserved for ${goodType} exceeds goods`)
			assert(
				goods + allocated <= maxAmount,
				`${label}: goods+allocated for ${goodType} exceeds max`
			)
			assert(
				this.available(goodType) === goods - reserved,
				`${label}: available mismatch for ${goodType}`
			)
			assert((this.stock[goodType] || 0) === goods, `${label}: stock mismatch for ${goodType}`)
		}
	}

	@memoize
	get allocatedSlots(): boolean {
		return Object.values(this._allocated).some((qty) => qty > 0)
	}

	@memoize
	get fragmented(): GoodType | undefined {
		// SpecificStorage is not fragmented as it stores goods in single quantities per type
		return undefined
	}

	canStoreAll(goods: Goods): boolean {
		return Object.entries(goods).every(
			([goodType, qty]) => this.hasRoom(goodType as GoodType) >= qty
		)
	}
	hasRoom(goodType: GoodType): number {
		const maxAmount = this.maxAmounts[goodType] || 0
		const currentAmount = this._goods[goodType] || 0
		const allocated = this._allocated[goodType] || 0
		return maxAmount - currentAmount - allocated
	}

	@memoize
	get isEmpty(): boolean {
		return Object.values(this._goods).every((qty) => qty === 0)
	}

	@atomic
	addGood(goodType: GoodType, qty: number): number {
		this.assertIntegrity('SpecificStorage.addGood.before')
		const maxAmount = this.maxAmounts[goodType] || 0
		const currentAmount = this._goods[goodType] || 0
		const allocated = this._allocated[goodType] || 0
		const canStore = maxAmount - currentAmount - allocated
		const toStore = Math.min(qty, canStore)

		if (toStore > 0) {
			this._goods[goodType] = currentAmount + toStore
		}

		this.assertIntegrity('SpecificStorage.addGood.after')
		return toStore
	}
	@atomic
	removeGood(goodType: GoodType, qty: number): number {
		this.assertIntegrity('SpecificStorage.removeGood.before')
		const currentAmount = this._goods[goodType] || 0
		const reserved = this._reserved[goodType] || 0
		const available = Math.max(0, currentAmount - reserved)
		const toRemove = Math.min(qty, available)

		if (toRemove > 0) {
			this._goods[goodType] = currentAmount - toRemove
			if (this._goods[goodType] === 0) {
				delete this._goods[goodType]
			}
		} else if (qty > 0 && currentAmount > 0) {
			traces.allocations.warn?.(
				`[SpecificStorage] Cannot remove ${goodType} (qty ${qty}): have ${currentAmount} but ${reserved} are reserved.`
			)
		}

		this.assertIntegrity('SpecificStorage.removeGood.after')
		return toRemove
	}

	get stock(): { [k in GoodType]?: number } {
		return { ...this._goods }
	}

	// TODO: @memoize
	get availables(): { [k in GoodType]?: number } {
		const result: { [k in GoodType]?: number } = {}
		for (const [goodType, quantity] of Object.entries(this._goods)) {
			const available = quantity - (this._reserved[goodType as GoodType] || 0)
			if (available > 0) {
				result[goodType as GoodType] = available
			}
		}
		return result
	}

	available(goodType: GoodType): number {
		return (this._goods[goodType] || 0) - (this._reserved[goodType] || 0)
	}

	allocated(goodType: GoodType): number {
		return this._allocated[goodType] || 0
	}

	renderedGoods(): RenderedGoodSlots {
		const slots: RenderedGoodSlot[] = []
		for (const [goodType, maxAmount] of Object.entries(this.maxAmounts)) {
			assert(GoodType.allows(goodType), 'Good type not found in goods')
			const present = (this._goods[goodType] || 0) - (this._reserved[goodType] || 0)
			const allocated = this._allocated[goodType] || 0
			const reserved = this._reserved[goodType] || 0
			const allowed = maxAmount
			slots.push({ goodType, present, allocated, reserved, allowed })
		}
		return { slots, assumedMaxSlots: Object.keys(this.maxAmounts).length }
	}
	allocate(goods: Goods, reason: any): SpecificAllocation {
		this.assertIntegrity('SpecificStorage.allocate.before')
		const actualGoods: Goods = {}
		let hasAnyAllocation = false

		for (const [goodType, qty] of Object.entries(goods) as [GoodType, number][]) {
			assert(qty && qty > 0, 'qty must be set')

			const room = this.hasRoom(goodType)
			const take = Math.min(qty, room)
			if (take > 0) {
				this._allocated[goodType] = (this._allocated[goodType] || 0) + take
				actualGoods[goodType] = take
				hasAnyAllocation = true
			}
		}

		if (!hasAnyAllocation && Object.keys(goods).length > 0) {
			throw new AllocationError(`Insufficient room to allocate any goods`, reason)
		}

		if (Object.keys(goods).length === 0) {
			throw new AllocationError(`Empty goods object provided for allocation`, reason)
		}

		this.assertIntegrity('SpecificStorage.allocate.after')
		return new SpecificAllocation(this, actualGoods, reason)
	}

	reserve(goods: Goods, reason: any): SpecificAllocation {
		this.assertIntegrity('SpecificStorage.reserve.before')
		const actualGoods: Goods = {}
		let hasAnyReservation = false

		for (const [goodType, qty] of Object.entries(goods) as [GoodType, number][]) {
			assert(qty && qty > 0, 'qty must be set')

			const available = (this._goods[goodType] || 0) - (this._reserved[goodType] || 0)
			const take = Math.min(qty, available)
			if (take > 0) {
				this._reserved[goodType] = (this._reserved[goodType] || 0) + take
				actualGoods[goodType] = -take // Negative for reservations
				hasAnyReservation = true
			}
		}

		if (!hasAnyReservation) {
			throw new AllocationError(`Insufficient goods to reserve any goods`, reason)
		}

		this.assertIntegrity('SpecificStorage.reserve.after')
		return new SpecificAllocation(this, actualGoods, reason)
	}

	get debugInfo(): Record<string, any> {
		return {
			type: 'SpecificStorage',
			maxAmounts: this.maxAmounts,
			currentGoods: this.stock,
		}
	}
}
