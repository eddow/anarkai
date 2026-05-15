import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { Tile } from 'ssh/board/tile'
import type { Character } from 'ssh/population/character'
import { contract } from 'ssh/types'
import { axial, epsilon } from 'ssh/utils'
import { type Positioned, positionRoughlyEquals, toAxialCoord } from 'ssh/utils/position'
import { subject } from '../scripts'
import { DurationStep, MoveToStep } from '../steps'

class WalkFunctions {
	declare [subject]: Character
	@contract('Positioned')
	moveTo(to: Positioned) {
		const toAxial = toAxialCoord(to)
		const fromAxial = toAxialCoord(this[subject])
		// ArkType validation now handles argument validation
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
	 * Enters in the tile even if it's not walkable
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
			const duration = axial.distance(fromAxial, target)
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
