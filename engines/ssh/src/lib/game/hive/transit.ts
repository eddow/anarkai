import type { GoodType } from '$lib/types'
import type { GoodsRelations } from '$lib/utils/advertisement'
import { Alveolus } from '../board/content/alveolus'

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
