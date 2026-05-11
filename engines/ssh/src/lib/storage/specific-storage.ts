import { atomic, memoize, reactive } from 'mutts'
import type { Commitment, FailureReason } from 'ssh/commitment'
import type { Goods } from 'ssh/types/base'
import { GoodType } from 'ssh/types/base'
import { assert, traces } from '../dev/debug.ts'
import type { RenderedGoodSlots } from '.'
import {
	type SpecificStorageSnapshot,
	specificStorageAllocationPlan,
	specificStorageAvailable,
	specificStorageAvailableGoods,
	specificStorageReservationPlan,
	specificStorageRoom,
} from './pure'
import { Storage } from './storage'
import type { RenderedGoodSlot } from './types'

@reactive
export class SpecificStorage extends Storage {
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
		return specificStorageRoom(this.snapshot(), goodType)
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
		if (toStore > 0) {
			this.notifyPresentationChanged('stock')
			this.notifyGameplayChanged('stock')
			this.notifyPlanningChanged('stock')
		}
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
		if (toRemove > 0) {
			this.notifyPresentationChanged('stock')
			this.notifyGameplayChanged('stock')
			this.notifyPlanningChanged('stock')
		}
		return toRemove
	}

	get stock(): { [k in GoodType]?: number } {
		return { ...this._goods }
	}

	get availables(): { [k in GoodType]?: number } {
		return specificStorageAvailableGoods(this.snapshot())
	}

	available(goodType: GoodType): number {
		return specificStorageAvailable(this.snapshot(), goodType)
	}

	allocated(goodType: GoodType): number {
		return this._allocated[goodType] || 0
	}

	get virtualGoodsCount(): number {
		let total = 0
		for (const qty of Object.values(this._reserved)) total += qty ?? 0
		for (const qty of Object.values(this._allocated)) total += qty ?? 0
		return total
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

	/**
	 * Allocate room for goods and register lifecycle callbacks on the commitment.
	 * @returns `undefined` on success, a string reason on failure.
	 */
	allocate(goods: Goods, commitment: Commitment): FailureReason {
		this.assertIntegrity('SpecificStorage.allocate.before')
		for (const [, qty] of Object.entries(goods) as [GoodType, number][]) {
			assert(qty && qty > 0, 'qty must be set')
		}
		const plan = specificStorageAllocationPlan(this.snapshot(), goods)
		if (!plan.ok) return plan.reason

		for (const [goodType, qty] of Object.entries(plan.goods) as [GoodType, number][]) {
			this._allocated[goodType] = (this._allocated[goodType] || 0) + qty
		}

		// Register lifecycle callbacks on the commitment
		commitment.onFulfilled(() => {
			this.assertIntegrity('SpecificStorage.allocate.fulfill.before')
			for (const [goodType, qty] of Object.entries(plan.goods) as [GoodType, number][]) {
				assert(qty, 'qty must be set')
				const curAlloc = this._allocated[goodType] || 0
				assert(curAlloc >= qty, 'fulfill: allocated less than fulfill qty')
				this._allocated[goodType] = curAlloc - qty
				this._goods[goodType] = (this._goods[goodType] || 0) + qty
			}
			this.assertIntegrity('SpecificStorage.allocate.fulfill.after')
			this.notifyPresentationChanged('stock')
			this.notifyGameplayChanged('stock')
			this.notifyPlanningChanged('stock')
		})

		commitment.onCancelled(() => {
			this.assertIntegrity('SpecificStorage.allocate.cancel.before')
			for (const [goodType, qty] of Object.entries(plan.goods) as [GoodType, number][]) {
				assert(qty, 'qty must be set')
				const curAlloc = this._allocated[goodType] || 0
				assert(curAlloc >= qty, 'cancel: allocated less than cancel qty')
				this._allocated[goodType] = curAlloc - qty
			}
			this.assertIntegrity('SpecificStorage.allocate.cancel.after')
			this.notifyPresentationChanged('allocation')
			this.notifyPlanningChanged('allocation')
		})

		this.assertIntegrity('SpecificStorage.allocate.after')
		this.notifyPresentationChanged('allocation')
		this.notifyPlanningChanged('allocation')
		return undefined
	}

	/**
	 * Reserve existing goods for removal and register lifecycle callbacks on the commitment.
	 * @returns `undefined` on success, a string reason on failure.
	 */
	reserve(goods: Goods, commitment: Commitment): FailureReason {
		this.assertIntegrity('SpecificStorage.reserve.before')

		for (const [, qty] of Object.entries(goods) as [GoodType, number][]) {
			assert(qty && qty > 0, 'qty must be set')
		}
		const plan = specificStorageReservationPlan(this.snapshot(), goods)
		if (!plan.ok) return plan.reason

		for (const [goodType, qty] of Object.entries(plan.goods) as [GoodType, number][]) {
			this._reserved[goodType] = (this._reserved[goodType] || 0) + qty
		}

		// Register lifecycle callbacks on the commitment
		commitment.onFulfilled(() => {
			this.assertIntegrity('SpecificStorage.reserve.fulfill.before')
			for (const [goodType, qty] of Object.entries(plan.goods) as [GoodType, number][]) {
				assert(qty, 'qty must be set')
				const want = qty
				const curRes = this._reserved[goodType] || 0
				const have = this._goods[goodType] || 0
				assert(curRes >= want, 'fulfill: reserved less than fulfill qty')
				assert(have >= want, 'fulfill: goods less than fulfill qty')
				this._reserved[goodType] = curRes - want
				this._goods[goodType] = have - want
			}
			this.assertIntegrity('SpecificStorage.reserve.fulfill.after')
			this.notifyPresentationChanged('stock')
			this.notifyGameplayChanged('stock')
			this.notifyPlanningChanged('stock')
		})

		commitment.onCancelled(() => {
			this.assertIntegrity('SpecificStorage.reserve.cancel.before')
			for (const [goodType, qty] of Object.entries(plan.goods) as [GoodType, number][]) {
				assert(qty, 'qty must be set')
				const curRes = this._reserved[goodType] || 0
				assert(curRes >= qty, 'cancel: reserved less than cancel qty')
				this._reserved[goodType] = curRes - qty
			}
			this.assertIntegrity('SpecificStorage.reserve.cancel.after')
			this.notifyPresentationChanged('reservation')
			this.notifyPlanningChanged('reservation')
		})

		this.assertIntegrity('SpecificStorage.reserve.after')
		this.notifyPresentationChanged('reservation')
		this.notifyPlanningChanged('reservation')
		return undefined
	}

	get debugInfo(): Record<string, any> {
		return {
			type: 'SpecificStorage',
			maxAmounts: this.maxAmounts,
			currentGoods: this.stock,
		}
	}

	private snapshot(): SpecificStorageSnapshot {
		return {
			stock: this._goods,
			reserved: this._reserved,
			allocated: this._allocated,
			maxAmounts: this.maxAmounts,
		}
	}
}
