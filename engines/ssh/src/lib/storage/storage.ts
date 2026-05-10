import { ReactiveBase } from 'mutts'
import type { Commitment, FailureReason } from 'ssh/commitment'
import { traceProjection } from 'ssh/dev/trace'
import type { Goods, GoodType } from 'ssh/types/base'
import type { RenderedGoodSlots } from './types'

export type StoragePresentationChangeKind = 'stock' | 'allocation' | 'reservation'
export type StoragePresentationChangeNotifier = (kind: StoragePresentationChangeKind) => void
export type StorageGameplayChangeKind = 'stock'
export type StorageGameplayChangeNotifier = (kind: StorageGameplayChangeKind) => void

export abstract class Storage extends ReactiveBase {
	private presentationChangeNotifier: StoragePresentationChangeNotifier | undefined
	private gameplayChangeNotifier: StorageGameplayChangeNotifier | undefined

	setPresentationChangeNotifier(notifier: StoragePresentationChangeNotifier | undefined): void {
		this.presentationChangeNotifier = notifier
	}

	setGameplayChangeNotifier(notifier: StorageGameplayChangeNotifier | undefined): void {
		this.gameplayChangeNotifier = notifier
	}

	protected notifyPresentationChanged(kind: StoragePresentationChangeKind): void {
		this.presentationChangeNotifier?.(kind)
	}

	protected notifyGameplayChanged(kind: StorageGameplayChangeKind): void {
		this.gameplayChangeNotifier?.(kind)
	}

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
	 * Allocate room for goods and register lifecycle callbacks on the commitment.
	 * @returns `undefined` on success, a string reason on failure.
	 */
	abstract allocate(goods: Goods, commitment: Commitment): FailureReason
	/**
	 * Reserve existing goods for removal and register lifecycle callbacks on the commitment.
	 * @returns `undefined` on success, a string reason on failure.
	 */
	abstract reserve(goods: Goods, commitment: Commitment): FailureReason

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
	/**
	 * Get currently allocated incoming quantity for a good type
	 */
	abstract allocated(goodType: GoodType): number
	/**
	 * Goods currently represented by storage bookkeeping rather than settled stock.
	 *
	 * Reservations are outgoing/present goods promised to work in progress; allocations are incoming
	 * room promised to work in progress.
	 */
	abstract get virtualGoodsCount(): number

	/** Render a visualization of stored goods */
	abstract renderedGoods(): RenderedGoodSlots
	abstract get allocatedSlots(): boolean

	/**
	 * Check if storage is fragmented (goods can be re-organized)
	 * @returns the fragmented GoodType if storage is fragmented, undefined otherwise
	 */
	abstract get fragmented(): GoodType | undefined

	get [traceProjection]() {
		return {
			$type: 'Storage',
			stock: this.stock,
			available: this.availables,
			isEmpty: this.isEmpty,
		}
	}
}
