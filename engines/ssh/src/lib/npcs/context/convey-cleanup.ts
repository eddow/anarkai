import type { LooseGood } from 'ssh/board/looseGoods'
import type { TrackedMovement } from 'ssh/hive/hive'
import type { Character } from 'ssh/population/character'
import type { AllocationBase } from 'ssh/storage'
import type { AxialCoord } from 'ssh/utils'

export interface FailedConveyMovementData {
	movement: TrackedMovement
	hopAlloc?: AllocationBase
	from: AxialCoord
	moving?: LooseGood
	sourceFulfilled?: boolean
}

// This list is an operational containment boundary, not a semantic model of all convey failures.
// Keep it narrow: only errors that happen after convey has already mutated the world and that can
// be safely unwound by cleanup belong here. If a failure can be prevented by re-checking preconditions
// or represented as an ordinary "refusal / stale job" result, do that instead of extending this list.
//
// TODO: Replace this string-based triage with typed failure kinds and a two-phase convey handoff:
// 1. preflight next-hop room / source validity without mutating world state
// 2. only then fulfill source, advance tracking, and publish the visual move
// After that structural change, this list should shrink to true invariant-break / teardown recovery only.
const recoverableConveyErrorSnippets = [
	// Accounting changed under us after the step started, but cleanup can safely roll back.
	'reserved less than fulfill qty',
	'allocated less than fulfill qty',
	'goods less than fulfill qty',
	'slot missing for allocated/reserved entry',
	'not enough room in slot',
	'Insufficient room to allocate any goods',
	'Insufficient goods to reserve any goods',
	// Mid-handoff bookkeeping drift: cleanup can restore a consistent baseline and let jobs retry.
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
	{ movement, hopAlloc, from, moving, sourceFulfilled }: FailedConveyMovementData
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
	movement.claimed = false
	delete movement.claimedBy
	delete movement.claimedAtMs
	hopAlloc?.cancel()
	hive.cancelMovementSource(movement, 'cleanupFailedConveyMovement')
	movement.allocations.target.cancel()
	hive.noteMovementStorageCheckpoint(
		movement,
		'cleanupFailedConveyMovement.after-cancel',
		movement.from
	)
	if (moving) {
		if (!moving.isRemoved) moving.remove()
	} else if (sourceFulfilled) {
		character.game.hex.looseGoods.add(from, movement.goodType)
	}
	movement.abort()
}
