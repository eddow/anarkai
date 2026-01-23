import { reactive } from 'mutts'
import { Alveolus } from 'ssh/src/lib/board/content/alveolus'
import type { GoodType } from 'ssh/src/lib/types'
import type { GoodsRelations } from 'ssh/src/lib/utils/advertisement'

@reactive
export class TransitAlveolus extends Alveolus {
	get workingGoodsRelations(): GoodsRelations {
		return Object.fromEntries(
			Object.keys(this.storage.availables).map((goodType) => [
				goodType as GoodType,
				{ advertisement: 'provide', priority: '2-use' },
			]),
		)
	}
}
