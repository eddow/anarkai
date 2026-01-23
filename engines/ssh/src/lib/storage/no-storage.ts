import type { Goods, GoodType } from '$lib/types/base'
import { AllocationError } from './guard'
import { Storage } from './storage'
import type { RenderedGoodSlots } from './types'

export class NoStorage extends Storage {
	hasRoom(_goodType?: GoodType): number {
		return 0
	}

	get allocatedSlots(): boolean {
		return false
	}

	get fragmented(): GoodType | undefined {
		return undefined
	}

	addGood(_goodType: GoodType, _qty: number): number {
		return 0
	}

	removeGood(_goodType: GoodType, _qty: number): number {
		return 0
	}

	get stock(): { [k in GoodType]?: number } {
		return {}
	}

	get availables(): { [k in GoodType]?: number } {
		return {}
	}

	available(_goodType: GoodType): number {
		return 0
	}

	allocate(_goods: Goods, reason: any): never {
		throw new AllocationError(`Cannot allocate goods - no storage available`, reason)
	}

	reserve(_goods: Goods, reason: any): never {
		throw new AllocationError(`Cannot reserve goods - no storage available`, reason)
	}

	renderedGoods(): RenderedGoodSlots {
		return { slots: [] }
	}

	get debugInfo(): Record<string, any> {
		return {
			type: 'NoStorage',
		}
	}
	canStoreAll(_goods: Goods): boolean {
		return false
	}

	get isEmpty(): boolean {
		return true
	}
}

export const noStorage = new NoStorage()
