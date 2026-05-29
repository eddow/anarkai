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
		for (const plan of this.game.hivePlans.validatingPlans) {
			for (const [good, qty] of Object.entries(plan.validationProgress.requiredGoods)) {
				const delivered = plan.validationProgress.deliveredGoods[good as GoodType] ?? 0
				const stocked = this.storage.stock[good as GoodType] ?? 0
				if (delivered + stocked < (qty ?? 0)) {
					relations[good as GoodType] = { advertisement: 'demand', priority: '1-buffer' }
				}
			}
		}
		return relations
	}
}
