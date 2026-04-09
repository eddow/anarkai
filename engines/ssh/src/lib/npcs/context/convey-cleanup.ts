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

const recoverableConveyErrorSnippets = [
	'reserved less than fulfill qty',
	'allocated less than fulfill qty',
	'goods less than fulfill qty',
	'slot missing for allocated/reserved entry',
	'not enough room in slot',
	'Target allocation missing',
	'Failed to reserve storage for next hop',
	'Movement became invalid after place',
	'Movement became invalid after hop handoff',
] as const

export function isRecoverableConveyError(error: unknown): boolean {
	if (!(error instanceof Error)) return false
	return recoverableConveyErrorSnippets.some((snippet) => error.message.includes(snippet))
}

export function cleanupFailedConveyMovement(
	character: Character,
	{ mg, hopAlloc, from, moving, sourceFulfilled }: FailedConveyMovementData
) {
	mg.claimed = false
	delete (mg as any).claimedBy
	delete (mg as any).claimedAtMs
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
