import { inert, memoize, reactive, untracked } from 'mutts'
import { Alveolus } from 'ssh/board/content/alveolus'
import { multiplyGoodsQty } from 'ssh/board/content/utils'
import type { Tile } from 'ssh/board/tile'
import type { Character } from 'ssh/population/character'
import { SpecificStorage } from 'ssh/storage'
import type { GoodType, TransformJob } from 'ssh/types/base'
import { type ExchangePriority, type GoodsRelations, maxPriority } from 'ssh/utils/advertisement'
import { inputBufferSize, outputBufferSize } from '../../../assets/constants'
import { jobBalance } from '../../../assets/game-content'

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
			})
		)
	}

	/**
	 * Check if this transformer can take a specific good as input
	 */
	canTake(goodType: GoodType, _priority: ExchangePriority): boolean {
		if (!this.working) return false

		const action = this.action
		const inputs = action?.inputs ?? emptyGoods

		// Can only take goods that are defined as inputs
		const isInput = goodType in inputs

		// Check if storage has capacity for this input
		// Use canStoreAll to check if we can store at least 1 of this good type
		const hasCapacity = this.storage.canStoreAll({ [goodType]: 1 })

		return isInput && hasCapacity
	}

	/**
	 * Check if this transformer can give a specific good as output
	 */
	canGive(goodType: GoodType, _priority: ExchangePriority): boolean {
		if (!this.working) return false

		const action = this.action
		const output = action?.output ?? emptyGoods

		// Can only give goods that are defined as outputs
		const isOutput = goodType in output

		// Check if storage has available goods of this type
		const hasAvailable = this.storage.available(goodType) > 0

		return isOutput && hasAvailable
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
			return inert(() => {
				if (!this.working || !this.canWork) return undefined

				return {
					job: 'transform',
					urgency: jobBalance.transform,
					fatigue: this.getFatigueCost(),
				}
			})
	}
	get workingGoodsRelations(): GoodsRelations {
		const action = this.action
		const inputs = action?.inputs ?? emptyGoods
		const output = action?.output ?? emptyGoods
		const demandPriority = untracked`transform.workingGoodsRelations.demandPriority`(() =>
			maxPriority(
				Object.keys(output).map((goodType) =>
					this.hive.needs[goodType as GoodType] ? '1-buffer' : '2-use'
				)
			)
		)
		// Note: only depend on stock (actual goods), never on reservation/allocation bookkeeping.
		const stock = this.storage.stock
		return Object.fromEntries([
			...Object.entries(inputs)
				.filter(([goodType, required]) => {
					const plannedStock =
						(stock[goodType as GoodType] ?? 0) + this.storage.allocated(goodType as GoodType)
					return plannedStock < required * inputBufferSize
				})
				.map(([goodType]) => [
					goodType as GoodType,
					{ advertisement: 'demand', priority: demandPriority },
				]),
			...Object.keys(output)
				.filter((goodType) => this.canGive(goodType as GoodType, '2-use'))
				.map((goodType) => [goodType as GoodType, { advertisement: 'provide', priority: '2-use' }]),
		])
	}
}
