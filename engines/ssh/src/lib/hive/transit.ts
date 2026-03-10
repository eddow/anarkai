import { reactive } from 'mutts'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { GoodType } from 'ssh/types'
import type { GoodsRelations } from 'ssh/utils/advertisement'

@reactive
export class TransitAlveolus extends Alveolus {
	get workingGoodsRelations(): GoodsRelations {
		return Object.fromEntries(
			Object.keys(this.storage.stock).map((goodType) => [
				goodType as GoodType,
				{ advertisement: 'provide', priority: '2-use' },
			])
		)
	}
}
