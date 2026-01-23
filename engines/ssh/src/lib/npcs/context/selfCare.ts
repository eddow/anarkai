import { subject } from 'ssh/src/lib/npcs/scripts'
import { EatStep, PonderingStep } from 'ssh/src/lib/npcs/steps'
import type { Character } from 'ssh/src/lib/population/character'
import { contract, type GoodType } from 'ssh/src/lib/types'

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
