import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { Tile } from 'ssh/board/tile'
import type { Character } from 'ssh/population/character'
import { contract } from 'ssh/types'
import { axial, epsilon } from 'ssh/utils'
import { type Positioned, positionRoughlyEquals, toAxialCoord } from 'ssh/utils/position'
import { subject } from '../scripts'
import { DurationStep, MoveToStep } from '../steps'

/**
 * Minimum walk duration per hex-second, even on the fastest terrain with road bonuses.
 * Even icy asphalt roads have finite walk time — no teleporting.
 */
const MIN_WALK_DURATION_PER_HEX = 0.1

/**
 * Canonical walk duration for a character moving from one position to another.
 *
 * This is the **single** formula used by every walk duration calculation in the game.
 * It accounts for:
 * - Terrain walk time via {@link Tile.effectiveWalkTime}
 * - Road bonuses via {@link HexBoard.walkTimeBetween}
 * - Vehicle speed via {@link Character.mobilityMultiplier}
 * - A defensive floor ({@link MIN_WALK_DURATION_PER_HEX} × distance) so no walk
 *   ever produces a near-zero or zero duration.
 *
 * @returns Duration in virtual seconds, or `Number.POSITIVE_INFINITY` if impassable.
 */
export function characterWalkDuration(
	character: Character,
	from: Positioned,
	to: Positioned
): number {
	const fromAxial = toAxialCoord(from)
	const toAxial = toAxialCoord(to)
	if (!fromAxial || !toAxial) return Number.POSITIVE_INFINITY
	const distance = axial.distance(fromAxial, toAxial)
	const baseWalkTime = character.game.hex.walkTimeBetween(
		from,
		to,
		character.tile.effectiveWalkTime
	)
	const duration = baseWalkTime * character.mobilityMultiplier * distance
	const floor = MIN_WALK_DURATION_PER_HEX * distance
	return Math.max(floor, duration)
}

class WalkFunctions {
	declare [subject]: Character
	/**
	 * Move the character to a specific position.
	 *
	 * Creates a {@link MoveToStep} that lerps the character's position from current to `to`.
	 * Does nothing if already at the target (`positionRoughlyEquals`).
	 * The returned step drives visual interpolation and is the canonical way to change position.
	 */
	@contract('Positioned')
	moveTo(to: Positioned) {
		if (!to) return
		const toAxial = toAxialCoord(to)
		const fromAxial = toAxialCoord(this[subject])
		if (!positionRoughlyEquals(fromAxial, toAxial)) {
			const baseWalkTime =
				this[subject].game.hex.walkTimeBetween(
					fromAxial,
					toAxial,
					this[subject].tile.effectiveWalkTime
				) * this[subject].mobilityMultiplier
			const duration = baseWalkTime * axial.distance(fromAxial, toAxial)
			if (Number.isFinite(duration) && duration > epsilon) {
				return new MoveToStep(duration, this[subject], to)
			}
		}
	}
	/**
	 * Move the character from its current position to the tile center (or deposit entry point).
	 *
	 * Creates a {@link MoveToStep}. Does nothing if already at the target.
	 * Does **not** call {@link Character.stepOn} — the caller is already on the tile.
	 */
	@contract()
	enter() {
		const tile = this[subject].tile
		const toAxial = toAxialCoord(tile)
		const fromAxial = toAxialCoord(this[subject])
		// If tile has a deposit, target deposit entry position instead of tile center
		const target =
			tile.content instanceof UnBuiltLand && tile.content.deposit
				? tile.content.depositEntryPosition
				: toAxial
		if (!positionRoughlyEquals(fromAxial, target)) {
			const duration = characterWalkDuration(this[subject], this[subject].position, target)
			if (Number.isFinite(duration) && duration > epsilon) {
				return new MoveToStep(duration, this[subject], target)
			}
		}
	}
	@contract('Tile')
	stepOn(tile: Tile) {
		return this[subject].stepOn(tile)
	}
	@contract()
	pause() {
		return new DurationStep(0.01, 'idle', 'walk.pause')
	}
	@contract('Tile')
	can(_tile: Tile) {
		return Number.isFinite(this[subject].tile.effectiveWalkTime)
	}
}

export { WalkFunctions }
