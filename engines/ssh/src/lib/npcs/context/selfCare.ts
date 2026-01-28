import { subject } from 'ssh/npcs/scripts'
import { EatStep, PonderingStep } from 'ssh/npcs/steps'
import type { Character } from 'ssh/population/character'
import { contract, type GoodType } from 'ssh/types'

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
