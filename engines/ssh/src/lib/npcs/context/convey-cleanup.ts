import type { LooseGood } from 'ssh/board/looseGoods'
import type { TrackedMovement } from 'ssh/hive/hive'
import type { Character } from 'ssh/population/character'
import type { AxialCoord } from 'ssh/utils'

export interface FailedConveyMovementData {
	movement: TrackedMovement
	from: AxialCoord
	hop?: AxialCoord
	moving?: LooseGood
	sourceFulfilled?: boolean
	hopAllocationFulfilled?: boolean
}

export function cleanupFailedConveyMovement(
	character: Character,
	{
		movement,
		from,
		hop,
		moving,
		sourceFulfilled,
		hopAllocationFulfilled,
	}: FailedConveyMovementData
) {
	const hive = movement.provider.hive
	hive.noteMovementLifecycle(movement, 'cleanupFailedConveyMovement.enter')
	hive.noteMovementStorageCheckpoint(movement, 'cleanupFailedConveyMovement.before', movement.from)
	;(movement._debug ??= { sourceTrail: [], lifecycleTrail: [] }).lastCleanupBy =
		'cleanupFailedConveyMovement'
	if (hive.movementLifecycleIncludes(movement, 'movement.finish.before')) {
		throw new Error(
			`cleanupFailedConveyMovement.after-finish-started: cleanup entered after terminal finish started; ${hive.describeMovementMineContext(movement)}`
		)
	}
	try {
		movement.provider.hive.assertMovementMine(movement, {
			label: 'cleanupFailedConveyMovement.before',
			expectedFrom: movement.from,
			expectClaimed: movement.claimed,
			requireTracked: false,
			requireSourceValid: false,
			requireTargetValid: false,
			allowClaimedSourceGap: true,
			allowClaimedTerminalPath: true,
			allowUntracked: true,
		})
	} catch (error) {
		hive.noteMovementCaughtError(movement, 'cleanupFailedConveyMovement.assert', error)
	}
	movement.claimed = false
	delete movement.claimedBy
	delete movement.claimedAtMs
	hive.cancelMovementSource(movement, 'cleanupFailedConveyMovement')
	movement.allocations.target.cancel('cleanupFailedConveyMovement')
	hive.noteMovementStorageCheckpoint(
		movement,
		'cleanupFailedConveyMovement.after-cancel',
		movement.from
	)
	if (moving) {
		if (!moving.isRemoved) moving.remove()
	}
	if (sourceFulfilled) {
		character.game.hex.looseGoods.add(from, movement.goodType)
	}
	if (hopAllocationFulfilled && hop) {
		hive.storageAt(hop)?.removeGood(movement.goodType, 1)
	}
	movement.abort()
}
