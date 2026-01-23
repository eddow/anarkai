import { atomic, memoize, reactive, unreactive } from 'mutts'
import { assert } from 'ssh/src/lib/debug'
import type { Goods } from 'ssh/src/lib/types/base'
import { GoodType } from 'ssh/src/lib/types/base'
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

@unreactive
class SpecificAllocation implements AllocationBase {
	constructor(
		private storage: SpecificStorage,
		public readonly goods: Goods,
		reason: any,
	) {
		guardAllocation(this, reason)
	}

	@atomic
	cancel(): void {
		if (!isAllocationValid(this)) return
		allocationEnded(this)
		invalidateAllocation(this)

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
	}

	@atomic
	fulfill(): void {
		if (!isAllocationValid(this)) return
		allocationEnded(this)
		invalidateAllocation(this)

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
	}
}

@reactive
export class SpecificStorage extends Storage<SpecificAllocation> {
	public readonly _goods: { [k in GoodType]?: number } = reactive({})
	public readonly _allocated: { [k in GoodType]?: number } = reactive({})
	public readonly _reserved: { [k in GoodType]?: number } = reactive({})
	public readonly maxAmounts: { [k in GoodType]?: number }

	constructor(maxAmounts: Ssh.SpecificStorage) {
		super()
		this.maxAmounts = { ...maxAmounts }
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
			([goodType, qty]) => this.hasRoom(goodType as GoodType) >= qty,
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
		const maxAmount = this.maxAmounts[goodType] || 0
		const currentAmount = this._goods[goodType] || 0
		const canStore = maxAmount - currentAmount
		const toStore = Math.min(qty, canStore)

		if (toStore > 0) {
			this._goods[goodType] = currentAmount + toStore
		}

		return toStore
	}
	@atomic
	removeGood(goodType: GoodType, qty: number): number {
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
			console.warn(
				`[SpecificStorage] Cannot remove ${goodType} (qty ${qty}): have ${currentAmount} but ${reserved} are reserved.`,
			)
		}

		return toRemove
	}

	//@memoize
	get stock(): { [k in GoodType]?: number } {
		return { ...this._goods }
	}

	//@memoize
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

		return new SpecificAllocation(this, actualGoods, reason)
	}

	reserve(goods: Goods, reason: any): SpecificAllocation {
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
