import { memoize } from 'mutts'
import { multiplyGoodsQty } from 'ssh/board/content/utils'
import type { Tile } from 'ssh/board/tile'
import { findGatherFreightLine } from 'ssh/freight/freight-line'
import { TransitAlveolus } from 'ssh/hive/transit'
import { SpecificStorage } from 'ssh/storage/specific-storage'
import { outputBufferSize } from '../../../assets/constants'
export class HarvestAlveolus extends TransitAlveolus {
	declare action: Ssh.HarvestingAction
	constructor(tile: Tile, definition: Ssh.AlveolusDefinition, resourceName: string) {
		if (definition.action.type !== 'harvest') {
			throw new Error('HarvestAlveolus can only be created from a harvest action')
		}
		super(
			tile,
			new SpecificStorage({
				...multiplyGoodsQty(definition.action.output, outputBufferSize),
			})
		)
		this.assignGameContent(definition, resourceName)
	}

	@memoize
	get canStoreInHarvester() {
		const output = this.action?.output
		return output ? this.storage.canStoreAll(output) : false
	}
	@memoize
	get hiveHasCollector() {
		const freightLines = this.tile?.game?.freightLines
		if (!freightLines?.length) return 0
		return Array.from(this.hive.alveoli).filter(
			(alveolus) => !!findGatherFreightLine(freightLines, alveolus)
		).length
	}

	@memoize
	get alveoliNeedingGood() {
		const output = this.action?.output
		if (!output) {
			return 0
		}
		return Object.keys(output).reduce(
			(acc, goodType) => acc + (goodType in this.hive.needs ? 1 : 0),
			0
		)
	}
}
