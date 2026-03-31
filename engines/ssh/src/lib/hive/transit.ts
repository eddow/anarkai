import { reactive } from 'mutts'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { GoodType } from 'ssh/types'
import type { ExchangePriority, GoodsRelations } from 'ssh/utils/advertisement'

@reactive
export class TransitAlveolus extends Alveolus {
	canTake(goodType: GoodType, _priority: ExchangePriority): boolean {
		return this.working && this.storage.hasRoom(goodType) > 0
	}

	canGive(goodType: GoodType, priority: ExchangePriority): boolean {
		return this.working && Number(priority[0]) > 0 && (this.storage.availables[goodType] ?? 0) > 0
	}

	get workingGoodsRelations(): GoodsRelations {
		return Object.fromEntries(
			Object.entries(this.storage.stock)
				.filter(([, quantity]) => quantity > 0) // Only advertise goods we actually have
				.map(([goodType]) => [
					goodType as GoodType,
					{ advertisement: 'provide', priority: '2-use' },
				])
		)
	}
}
