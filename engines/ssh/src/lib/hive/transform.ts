import { memoize, reactive } from 'mutts'
import { inputBufferSize, outputBufferSize } from '../../../assets/constants'
import { Alveolus } from 'ssh/board/content/alveolus'
import { multiplyGoodsQty } from 'ssh/board/content/utils'
import type { Tile } from 'ssh/board/tile'
import type { Character } from 'ssh/population/character'
import { SpecificStorage } from 'ssh/storage'
import type { GoodType, TransformJob } from 'ssh/types/base'
import { type GoodsRelations, maxPriority } from 'ssh/utils/advertisement'

const emptyGoods: Partial<Record<GoodType, number>> = {}

@reactive
export class TransformAlveolus extends Alveolus {
	declare action: Ssh.TransformationAction
	constructor(tile: Tile) {
		const def: Ssh.AlveolusDefinition = new.target.prototype
		if (def.action.type !== 'transform') {
			throw new Error('TransformAlveolus can only be created from a transform action')
		}
		super(
			tile,
			new SpecificStorage({
				...multiplyGoodsQty(def.action.inputs, inputBufferSize),
				...multiplyGoodsQty(def.action.output, outputBufferSize),
			}),
		)
	}
	@memoize
	get canWork(): boolean {
		const action = this.action
		const inputs = action?.inputs ?? emptyGoods
		const output = action?.output ?? emptyGoods
		return (
			// If we have all the inputs required
			Object.entries(inputs).every(([goodType, required]) => {
				return (this.storage.available(goodType as GoodType) || 0) >= (required as number)
			}) &&
			// If we have all the room for the outputs
			this.storage.canStoreAll(output)
		)
	}
	// nextJob() replaces both alveolusSpecificJob() and keepWorking
	nextJob(_character?: Character): TransformJob | undefined {
		if (!this.working || !this.canWork) return undefined

		return {
			job: 'transform',
			urgency: 1,
			fatigue: this.getFatigueCost(),
		}
	}
	get workingGoodsRelations(): GoodsRelations {
		const action = this.action
		const inputs = action?.inputs ?? emptyGoods
		const output = action?.output ?? emptyGoods
		const demandPriority = maxPriority(
			Object.keys(output).map((goodType) =>
				this.hive.needs[goodType] ? '1-buffer' : '2-use',
			),
		)
		// Note: only depend on stock (actual goods), never on reservation/allocation bookkeeping.
		const stock = this.storage.stock
		return Object.fromEntries([
			...Object.entries(inputs)
				.filter(([goodType, required]) => (stock[goodType as GoodType] ?? 0) < required * inputBufferSize)
				.map(([goodType]) => [
					goodType as GoodType,
					{ advertisement: 'demand', priority: demandPriority },
				]),
			...Object.keys(output)
				.filter((goodType) => (stock[goodType as GoodType] ?? 0) > 0)
				.map((goodType) => [goodType as GoodType, { advertisement: 'provide', priority: '2-use' }]),
		])
	}
}
