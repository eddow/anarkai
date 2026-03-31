import type { GoodType } from 'ssh/types/base'

export interface RenderedGoodSlot {
	/** Omitted when the physical slot is empty (unused capacity). */
	goodType?: GoodType
	present: number
	reserved: number
	allocated: number
	allowed: number
}

export interface RenderedGoodSlots {
	slots: RenderedGoodSlot[]
	assumedMaxSlots?: number
}
