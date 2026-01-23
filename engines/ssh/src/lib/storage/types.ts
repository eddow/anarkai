import type { GoodType } from 'ssh/src/lib/types/base'

export interface RenderedGoodSlot {
	goodType: GoodType
	present: number
	reserved: number
	allocated: number
	allowed: number
}

export interface RenderedGoodSlots {
	slots: RenderedGoodSlot[]
	assumedMaxSlots?: number
}
