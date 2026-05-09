import type { TrackedMovement } from 'ssh/hive/hive'
import { type AxialCoord, axial, type Positioned } from 'ssh/utils'
import type { Position } from 'ssh/utils/position'

export interface ConveyMovementSnapshot {
	from: AxialCoord
	hop: AxialCoord
	moving: { position: Position }
}

export function getConveyDuration(
	transferTime: number,
	movements: readonly Pick<ConveyMovementSnapshot, 'from' | 'hop'>[]
) {
	return movements.reduce((total, movement) => {
		const hopDistance = Math.max(1, axial.distance(movement.from, movement.hop))
		return total + transferTime * hopDistance * movements.length
	}, 0)
}

export function getConveyVisualMovements(movements: readonly ConveyMovementSnapshot[]): Array<{
	who: { position: Position }
	from: Position
	to: Positioned
}> {
	return movements.map(({ moving, from, hop }) => ({
		who: moving,
		from,
		to: hop,
	}))
}

/**
 * Rebinds each row's `movement` to the hive's canonical active entry when the {@link TrackedMovement.ref}
 * matches but the reference diverged (e.g. hive rebind). Returns false if any movement is no longer active.
 */
export function rebindConveyMovementRows<T extends { movement: TrackedMovement }>(
	rows: T[]
): boolean {
	for (const row of rows) {
		const hive = row.movement.provider.hive
		if (!hive) return false
		const live = hive.getCanonicalMovement(row.movement)
		if (!live) return false
		if (live !== row.movement) {
			if (row.movement.claimed && !live.claimed) {
				live.claimed = true
				live.claimedBy = row.movement.claimedBy
				live.claimedAtMs = row.movement.claimedAtMs
				live._state = row.movement._state
			}
			hive.noteMovementLifecycle(live, 'convey.rebind-to-canonical')
			row.movement = live
		}
	}
	return true
}
