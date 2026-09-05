import { reactive } from 'mutts'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import { SlottedStorage } from 'ssh/storage/slotted-storage'
import type { GoodType } from 'ssh/types/base'
import type { GoodsRelations } from 'ssh/utils/advertisement'

@reactive
export class EngineerAlveolus extends Alveolus {
	declare action: Ssh.EngineerAction
	constructor(tile: Tile, definition: Ssh.AlveolusDefinition, resourceName: string) {
		if (definition.action.type !== 'engineer') {
			throw new Error('EngineerAlveolus can only be created from an engineer action')
		}
		super(tile, new SlottedStorage(4, 2))
		this.assignGameContent(definition, resourceName)
	}

	get workingGoodsRelations(): GoodsRelations {
		const relations: GoodsRelations = {}
		for (const project of this.game.projects.projects) {
			// Committed projects only — drafts are private intent with no board demand.
			if (project.stage !== 'working') continue
			for (const [good, qty] of Object.entries(project.validationProgress.requiredGoods)) {
				const delivered = project.validationProgress.deliveredGoods[good as GoodType] ?? 0
				const stocked = this.storage.stock[good as GoodType] ?? 0
				if (delivered + stocked < (qty ?? 0)) {
					relations[good as GoodType] = { advertisement: 'demand', priority: '1-buffer' }
				}
			}
		}
		return relations
	}
}
