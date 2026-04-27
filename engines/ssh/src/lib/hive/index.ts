import { alveoli } from 'engine-rules'
import type { Alveolus } from 'ssh/board/content/alveolus'
import { GcClasses } from 'ssh/board/content/utils'
import type { Tile } from 'ssh/board/tile'
import type { AlveolusType } from 'ssh/types/base'
import { EngineerAlveolus } from './engineer'
import { HarvestAlveolus } from './harvest'
import { StorageAlveolus } from './storage'
import { TransformAlveolus } from './transform'

export const alveolusClass = GcClasses(
	(def: Ssh.AlveolusDefinition) =>
		({
			harvest: HarvestAlveolus,
			transform: TransformAlveolus,
			engineer: EngineerAlveolus,
			storage: StorageAlveolus,
			'road-fret': StorageAlveolus,
			'slotted-storage': StorageAlveolus,
			'specific-storage': StorageAlveolus,
		})[def.action.type],
	alveoli
) as Partial<Record<AlveolusType, new (tile: Tile) => Alveolus>>

export * from './alveolus-configuration'
export * from './hive'
