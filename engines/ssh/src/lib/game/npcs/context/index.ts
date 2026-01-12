import * as gameContent from '$assets/game-content'
import type { CharacterContract } from '$assets/scripts/contracts'
import { Alveolus } from '$lib/game/board/content/alveolus'
import type { HarvestAlveolus } from '$lib/game/hive/harvest'
import { contract } from '$lib/types'
import type { GoodType } from '$lib/types/base'
import { toAxialCoord } from '$lib/utils/position'
import type { Character } from '../../population/character'
import { InteractiveContext, protoCtx, subject } from '../scripts'
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
		instance[key] = Object.create(characterContext[key], {
			[subject]: { value: character, enumerable: false, configurable: true },
		})
	}
	return instance as CharacterContract & typeof characterContext
}
