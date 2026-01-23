import * as gameContent from '$assets/game-content'
import type { CharacterContract } from '$assets/scripts/contracts'
import { Alveolus } from '$lib/board/content/alveolus'
import type { HarvestAlveolus } from '$lib/hive/harvest'
import { contract } from '$lib/types'
import type { GoodType } from '$lib/types/base'
import type { Character } from '$lib/population/character'
import { InteractiveContext, protoCtx, subject } from '$lib/npcs/scripts'
// Import all the function classes
import { FindFunctions } from './find'
import { InventoryFunctions } from './inventory'
import { PlanFunctions } from './plan'
import { SelfCareFunctions } from './selfCare'
import { WalkFunctions } from './walk'
import { WorkFunctions } from './work'

// Re-export TransferPlan for external use
export { PickupPlan as GatherPlan, Plan, TransferPlan, WorkPlan } from '$lib/types/base'

class CharacterContext extends InteractiveContext<Character> {
	get I() {
		return this[subject]
	}
	@contract('GoodType?')
	haveRoom(goodType?: GoodType): number {
		return this[subject].carry.hasRoom(goodType)
	}
	@contract('Alveolus')
	isGatherable(harvestAlveolus: Alveolus) {
		// Return true if the harvest alveolus is full (can't store more)
		if ('canStoreInHarvester' in harvestAlveolus && !(harvestAlveolus as HarvestAlveolus).canStoreInHarvester) return true

		// TODO: check all gatherers collected by harvestAlveolus - even outside the hive
		const gatherers = harvestAlveolus.hive.byActionType.gather
		if (!gatherers || gatherers.length === 0) return false

		// Get the goods produced by this harvest alveolus
		if (!('output' in harvestAlveolus.action)) return false
		const producedGoods = Object.keys(harvestAlveolus.action.output) as GoodType[]

		// Check if any gatherer can reach this position and gather the produced goods
		const currentPos = this[subject].tile.position

		return gatherers.some((gatherer) => {
			// Check if the gatherer can reach this position within its radius (walk time)
			const path = this[subject].game.hex.findPath(
				gatherer.tile.position,
				currentPos,
				(gatherer.action as Ssh.GatherAction).radius,
				false,
			)

			// If no path exists within the radius, this gatherer can't reach us
			if (!path) return false

			// Check if the hive needs any of the produced goods
			return producedGoods.some((good) => good in harvestAlveolus.hive.needs)
		})
	}
}

import { objectMap } from '$lib/utils'
import { loadNpcScripts } from '../scripts'

const ScriptFiles = import.meta.glob('$assets/scripts/**/*.npcs', {
	query: '?raw',
	eager: true,
})

const nsProtos: any = {
	find: protoCtx(FindFunctions),
	inventory: protoCtx(InventoryFunctions),
	walk: protoCtx(WalkFunctions),
	selfCare: protoCtx(SelfCareFunctions),
	work: protoCtx(WorkFunctions),
	plan: protoCtx(PlanFunctions),
}

const characterContext = protoCtx(CharacterContext, {
	...nsProtos,
	...gameContent,
})

loadNpcScripts(
	objectMap(ScriptFiles, (v: any) => v.default) as Record<string, string>,
	characterContext,
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
