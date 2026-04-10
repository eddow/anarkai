import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { Tile } from 'ssh/board/tile'
import type { Character } from 'ssh/population/character'
import { contract } from 'ssh/types'
import { axial } from 'ssh/utils'
import { type Positioned, positionRoughlyEquals, toAxialCoord } from 'ssh/utils/position'
import { subject } from '../scripts'
import { MoveToStep } from '../steps'

class WalkFunctions {
	declare [subject]: Character
	@contract('Positioned')
	moveTo(to: Positioned) {
		const toAxial = toAxialCoord(to)
		const fromAxial = toAxialCoord(this[subject])
		// ArkType validation now handles argument validation
		if (!positionRoughlyEquals(fromAxial, toAxial))
			return new MoveToStep(
				this[subject].tile.effectiveWalkTime * axial.distance(fromAxial, toAxial),
				this[subject],
				to
			)
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
		if (!positionRoughlyEquals(fromAxial, target))
			return new MoveToStep(axial.distance(fromAxial, target), this[subject], target)
	}
	@contract('Tile')
	stepOn(tile: Tile) {
		return this[subject].stepOn(tile)
	}
	@contract('Tile')
	can(_tile: Tile) {
		return Number.isFinite(this[subject].tile.effectiveWalkTime)
	}
}

export { WalkFunctions }
