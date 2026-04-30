import { alveoli } from 'engine-rules'
import type { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import type { AlveolusType } from 'ssh/types/base'
import { EngineerAlveolus } from './engineer'
import { HarvestAlveolus } from './harvest'
import { StorageAlveolus } from './storage'
import { TransformAlveolus } from './transform'

type AlveolusCtor = new (
	tile: Tile,
	definition: Ssh.AlveolusDefinition,
	resourceName: string
) => Alveolus

function ctorForDefinition(def: Ssh.AlveolusDefinition): AlveolusCtor | undefined {
	switch (def.action.type) {
		case 'harvest':
			return HarvestAlveolus
		case 'transform':
			return TransformAlveolus
		case 'engineer':
			return EngineerAlveolus
		case 'storage':
		case 'road-fret':
		case 'slotted-storage':
		case 'specific-storage':
			return StorageAlveolus
		default:
			return undefined
	}
}

export function createAlveolus(resourceName: AlveolusType, tile: Tile): Alveolus | undefined {
	const def = alveoli[resourceName as keyof typeof alveoli]
	if (!def) return undefined
	const Ctor = ctorForDefinition(def)
	if (!Ctor) return undefined
	return new Ctor(tile, def, resourceName)
}

export * from './alveolus-configuration'
export * from './hive'
