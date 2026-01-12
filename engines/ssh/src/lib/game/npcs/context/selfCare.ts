import type { Character } from '$lib/game/population/character'
import { contract, type GoodType } from '$lib/types'
import { subject } from '../scripts'
import { EatStep, PonderingStep } from '../steps'

class SelfCareFunctions {
	declare [subject]: Character
	@contract('GoodType')
	eat(food: GoodType) {
		return new EatStep(this[subject], food)
	}
	@contract()
	pondering() {
		return new PonderingStep(this[subject])
	}
}

export { SelfCareFunctions }
