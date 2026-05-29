import { Alveolus } from 'ssh/board/content/alveolus'
import {
	type PlantedTreesState,
	plantDepositOnLand,
	UnBuiltLand,
} from 'ssh/board/content/unbuilt-land'
import type { Tile } from 'ssh/board/tile'
import type { Character } from 'ssh/population/character'
import { noStorage } from 'ssh/storage/no-storage'
import type { GoodsRelations } from 'ssh/utils/advertisement'

export class ForesterAlveolus extends Alveolus {
	declare action: Ssh.PlantingAction

	constructor(tile: Tile, definition: Ssh.AlveolusDefinition, resourceName: string) {
		if (definition.action.type !== 'plant') {
			throw new Error('ForesterAlveolus can only be created from a plant action')
		}
		super(tile, noStorage)
		this.assignGameContent(definition, resourceName)
	}

	get workingGoodsRelations(): GoodsRelations {
		return {}
	}

	plantAtCurrentTile(character: Character): boolean {
		const content = character.tile.content
		return content instanceof UnBuiltLand ? plantDepositOnLand(content, this.action.deposit) : false
	}
}

export type { PlantedTreesState }
