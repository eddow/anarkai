import { ReactiveBase } from 'mutts'
import type { Goods, GoodType } from '$lib/types/base'
import type { RenderedGoodSlots } from './types'

export interface AllocationBase {
	cancel(): void
	fulfill(): void
}
export abstract class Storage<
	Allocation extends AllocationBase = AllocationBase,
> extends ReactiveBase {
	/**
	 * Check how much of a good can be stored
	 * @param goodType - The type of good to check
	 * @returns The maximum quantity that can be stored
	 */
	abstract hasRoom(goodType?: GoodType): number
	abstract get isEmpty(): boolean
	/**
	 * Check if all goods can be stored
	 * @param goods - The goods to check
	 * @returns true if all goods can be stored
	 */
	abstract canStoreAll(goods: Goods): boolean

	/**
	 * Add goods to storage
	 * @param goodType - The type of good to add
	 * @param qty - The quantity to add
	 * @returns The actual quantity that was stored
	 */
	abstract addGood(goodType: GoodType, qty: number): number

	/**
	 * Remove goods from storage
	 * @param goodType - The type of good to remove
	 * @param qty - The quantity to remove
	 * @returns The actual quantity that was removed
	 */
	abstract removeGood(goodType: GoodType, qty: number): number

	/**
	 * Allocate room for goods and return an opaque allocation token
	 * @throws Error if allocation fails (insufficient room)
	 */
	abstract allocate(goods: Goods, reason: any): Allocation
	/**
	 * Reserve existing goods for removal and return an opaque allocation token
	 * @throws Error if reservation fails (insufficient goods)
	 */
	abstract reserve(goods: Goods, reason: any): Allocation

	/**
	 * Get all goods currently stored (stock totals, includes reserved)
	 */
	abstract get stock(): Goods

	/**
	 * Get all goods currently available (unreserved quantities only)
	 */
	abstract get availables(): Goods

	/**
	 * Get currently available (unreserved) quantity for a good type
	 */
	abstract available(goodType: GoodType): number

	/** Render a visualization of stored goods */
	abstract renderedGoods(): RenderedGoodSlots
	abstract get allocatedSlots(): boolean

	/**
	 * Check if storage is fragmented (goods can be re-organized)
	 * @returns the fragmented GoodType if storage is fragmented, undefined otherwise
	 */
	abstract get fragmented(): GoodType | undefined
}
