import { memoize } from 'mutts'
import { inputBufferSize, outputBufferSize } from '$assets/constants'
import type { Character } from '$lib/game/population/character'
import { SpecificStorage } from '$lib/game/storage'
import type { GoodType, TransformJob } from '$lib/types/base'
import { type GoodsRelations, maxPriority } from '$lib/utils/advertisement'
import { Alveolus } from '../board/content/alveolus'
import { multiplyGoodsQty } from '../board/content/utils'
import type { Tile } from '../board/tile'

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
		return (
			// If we have all the inputs required
			Object.entries(this.action.inputs || {}).every(([goodType, required]) => {
				return (this.storage.available(goodType as GoodType) || 0) >= (required as number)
			}) &&
			// If we have all the room for the outputs
			this.storage.canStoreAll(this.action.output)
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
		const demandPriority = maxPriority(
			Object.keys(this.action.output).map((goodType) =>
				this.hive.needs[goodType] ? '1-buffer' : '2-use',
			),
		)
		// Note: need input with a priority set 1/2 on hive needing output or not
		return Object.fromEntries([
			...Object.keys(this.action.inputs)
				.filter((goodType) => this.storage.hasRoom(goodType as GoodType))
				.map((goodType) => [
					goodType as GoodType,
					{ advertisement: 'demand', priority: demandPriority },
				]),
			...Object.keys(this.action.output)
				.filter((goodType) => this.storage.available(goodType as GoodType) > 0)
				.map((goodType) => [goodType as GoodType, { advertisement: 'provide', priority: '2-use' }]),
		])
	}
}
