import type { Tile } from 'ssh/board/tile'
import { Commitment } from 'ssh/commitment'
import { subject } from 'ssh/npcs/scripts'
import { EatStep, type EatWorldSource, PonderingStep } from 'ssh/npcs/steps'
import type { Character } from 'ssh/population/character'
import { contract, type GoodType } from 'ssh/types'
import { toAxialCoord } from 'ssh/utils/position'

class SelfCareFunctions {
	declare [subject]: Character
	@contract()
	inventoryFood() {
		return this[subject].bestPersonalFood() ?? false
	}

	@contract('GoodType')
	eatFromInventory(goodType: GoodType) {
		const character = this[subject]
		if (character.personalGoodAvailable(goodType) < 1) return new PonderingStep(character)
		return new EatStep(character, goodType, { kind: 'personal' })
	}

	@contract('GoodType', 'Tile')
	takeFoodFromWorld(goodType: GoodType, tile: Tile) {
		const character = this[subject]
		const { hex } = character.game
		const coord = toAxialCoord(tile.position)
		const loose = hex.looseGoods
			.getGoodsAt(coord)
			.find((g) => g.goodType === goodType && g.available && !g.isRemoved)
		if (loose) {
			const commitment = new Commitment(`personal.loose.${goodType}`)
			const result = loose.allocate(commitment)
			if (result !== undefined) return false
			commitment.fulfill()
			character.addPersonalGood(goodType, 1)
			return true
		}
		const storage = tile.content?.storage
		if (storage && storage.available(goodType) >= 1) {
			const commitment = new Commitment(`personal.storage.${goodType}`)
			const result = storage.reserve({ [goodType]: 1 }, commitment)
			if (result !== undefined) return false
			commitment.fulfill()
			character.addPersonalGood(goodType, 1)
			return true
		}
		return false
	}

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
				return new PonderingStep(character)
			}
		}
		return new EatStep(character, goodType, source)
	}
	@contract()
	pondering() {
		return new PonderingStep(this[subject])
	}
}

export { SelfCareFunctions }
