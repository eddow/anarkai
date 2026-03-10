import type { Alveolus } from 'ssh/board/content/alveolus'
import { GcClasses } from 'ssh/board/content/utils'
import type { Tile } from 'ssh/board/tile'
import type { AlveolusType } from 'ssh/types/base'
import { alveoli } from '../../../assets/game-content'
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
	alveoli
) as Partial<Record<AlveolusType, new (tile: Tile) => Alveolus>>

export * from './alveolus-configuration'
export * from './hive'
