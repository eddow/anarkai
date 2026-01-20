import { alveoli } from '$assets/game-content'
import type { AlveolusType } from '$lib/types'
import { Tile } from '../board'
import type { Alveolus } from '../board/content/alveolus'
import { GcClasses } from '../board/content/utils'
import { EngineerAlveolus } from './engineer'
import { GatherAlveolus } from './gather'
import { HarvestAlveolus } from './harvest'
import { StorageAlveolus } from './storage'
import { TransformAlveolus } from './transform'

export const alveolusClass = GcClasses(
	(def: Ssh.AlveolusDefinition) =>
		({
			harvest: HarvestAlveolus,
			transform: TransformAlveolus,
			gather: GatherAlveolus,
			engineer: EngineerAlveolus,
			storage: StorageAlveolus, // kept for backward compatibility if any
			'slotted-storage': StorageAlveolus,
			'specific-storage': StorageAlveolus,
		})[def.action.type],
	alveoli,
) as Partial<Record<AlveolusType, new (tile: Tile) => Alveolus>>

export * from './hive'
export * from './alveolus-configuration'
