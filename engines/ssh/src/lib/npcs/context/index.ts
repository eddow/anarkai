import { InteractiveContext, protoCtx, subject } from 'ssh/npcs/scripts'
import type { Character } from 'ssh/population/character'
import * as gameContent from '../../../../assets/game-content'
import type { CharacterContract } from '../../../../assets/scripts/contracts'
// Import all the function classes
import { FindFunctions } from './find'
import { InventoryFunctions } from './inventory'
import { PlanFunctions } from './plan'
import { SelfCareFunctions } from './selfCare'
import { VehicleFunctions } from './vehicle'
import { WalkFunctions } from './walk'
import { WorkFunctions } from './work'

// Re-export TransferPlan for external use
export {
	PickupPlan as GatherPlan,
	Plan,
	TransferPlan,
	WorkPlan,
} from 'ssh/types/base'

class CharacterContext extends InteractiveContext<Character> {
	get I() {
		return this[subject]
	}
}

import { objectMap } from 'ssh/utils'
import { loadNpcScripts } from '../scripts'

const ScriptFiles = import.meta.glob('../../../../assets/scripts/**/*.npcs', {
	query: '?raw',
	eager: true,
})

const nsProtos: any = {
	find: protoCtx(FindFunctions),
	inventory: protoCtx(InventoryFunctions),
	walk: protoCtx(WalkFunctions),
	selfCare: protoCtx(SelfCareFunctions),
	vehicle: protoCtx(VehicleFunctions),
	work: protoCtx(WorkFunctions),
	plan: protoCtx(PlanFunctions),
}

const characterContext = protoCtx(CharacterContext, {
	...nsProtos,
	...gameContent,
})

loadNpcScripts(
	objectMap(ScriptFiles, (v: any) => v.default) as Record<string, string>,
	characterContext
)

export default function aCharacterContext(character: Character) {
	const instance = Object.create(characterContext, {
		[subject]: { value: character, enumerable: false, configurable: true },
	})
	for (const key of Object.keys(nsProtos)) {
		const contextProto = characterContext[key]
		if (!contextProto) {
			console.error(`[aCharacterContext] Missing context prototype for namespace: ${key}`)
			console.error('[aCharacterContext] characterContext:', Object.keys(characterContext))
			console.error('[aCharacterContext] nsProtos keys:', Object.keys(nsProtos))
			throw new Error(`Missing context prototype for namespace: ${key}`)
		}
		instance[key] = Object.create(contextProto, {
			[subject]: { value: character, enumerable: false, configurable: true },
		})
	}

	// Verify all namespaces are properly set up
	for (const key of Object.keys(nsProtos)) {
		if (!instance[key]) {
			console.error(`[aCharacterContext] Instance missing namespace after creation: ${key}`)
			throw new Error(`Instance missing namespace after creation: ${key}`)
		}
	}

	return instance as CharacterContract & typeof characterContext
}
