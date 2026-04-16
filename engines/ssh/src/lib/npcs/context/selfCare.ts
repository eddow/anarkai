import type { Tile } from 'ssh/board/tile'
import { subject } from 'ssh/npcs/scripts'
import { EatStep, type EatWorldSource, PonderingStep } from 'ssh/npcs/steps'
import type { Character } from 'ssh/population/character'
import { contract, type GoodType } from 'ssh/types'
import { toAxialCoord } from 'ssh/utils/position'

class SelfCareFunctions {
	declare [subject]: Character
	/**
	 * Eat food already on the ground or in tile storage after pathing to `tile`.
	 * Does not use character carry.
	 */
	@contract('GoodType', 'Tile')
	eatFromWorld(goodType: GoodType, tile: Tile) {
		const character = this[subject]
		const { hex } = character.game
		const coord = toAxialCoord(tile.position)
		const looseCandidates = hex.looseGoods
			.getGoodsAt(coord)
			.filter((g) => g.goodType === goodType && g.available && !g.isRemoved)
		let source: EatWorldSource
		if (looseCandidates.length > 0) {
			source = { kind: 'loose', looseGood: looseCandidates[0]! }
		} else {
			const storage = tile.content?.storage
			if (storage && storage.available(goodType) >= 1) {
				source = { kind: 'storage', storage }
			} else {
				throw new Error(
					`eatFromWorld: no available ${goodType} on tile (loose or storage). Coord=${JSON.stringify(coord)}`
				)
			}
		}
		return new EatStep(character, goodType, source)
	}
	@contract()
	pondering() {
		return new PonderingStep(this[subject])
	}
	@contract()
	releaseHome() {
		this[subject].game.hex.zoneManager.releaseReservation(this[subject])
	}
}

export { SelfCareFunctions }
