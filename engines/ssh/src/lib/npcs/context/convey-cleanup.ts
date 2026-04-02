import type { LocalMovingGood } from 'ssh/board'
import type { LooseGood } from 'ssh/board/looseGoods'
import type { Character } from 'ssh/population/character'
import type { AllocationBase } from 'ssh/storage'
import type { AxialCoord } from 'ssh/utils'

export interface FailedConveyMovementData {
	mg: LocalMovingGood
	hopAlloc?: AllocationBase
	from: AxialCoord
	moving?: LooseGood
	sourceFulfilled?: boolean
}

export function cleanupFailedConveyMovement(
	character: Character,
	{ mg, hopAlloc, from, moving, sourceFulfilled }: FailedConveyMovementData
) {
	mg.claimed = false
	hopAlloc?.cancel()
	mg.allocations.source.cancel()
	mg.allocations.target.cancel()
	if (moving) {
		if (!moving.isRemoved) moving.remove()
	} else if (sourceFulfilled) {
		character.game.hex.looseGoods.add(from, mg.goodType)
	}
	mg.finish()
}
