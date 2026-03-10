import { memoize } from 'mutts'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { multiplyGoodsQty } from 'ssh/board/content/utils'
import type { Tile } from 'ssh/board/tile'
import { TransitAlveolus } from 'ssh/hive/transit'
import type { Character } from 'ssh/population/character'
import { SpecificStorage } from 'ssh/storage/specific-storage'
import type { HarvestJob } from 'ssh/types/base'
import { axialDistance, type Positioned, toAxialCoord } from 'ssh/utils/position'
import { maxWalkTime, outputBufferSize } from '../../../assets/constants'
export class HarvestAlveolus extends TransitAlveolus {
	declare action: Ssh.HarvestingAction
	constructor(tile: Tile) {
		const def: Ssh.AlveolusDefinition = new.target.prototype
		if (def.action.type !== 'harvest') {
			throw new Error('HarvestAlveolus can only be created from a harvest action')
		}
		super(
			tile,
			new SpecificStorage({
				...multiplyGoodsQty(def.action.output, outputBufferSize),
			})
		)
	}

	@memoize
	get canStoreInHarvester() {
		const output = this.action?.output
		return output ? this.storage.canStoreAll(output) : false
	}
	@memoize
	get hiveHasCollector() {
		return this.hive.byActionType.gather?.length
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
	// nextJob() replaces both alveolusSpecificJob() and keepWorking
	// Returns detailed job info including path when called from character
	nextJob(character?: Character): HarvestJob | undefined {
		if (!this.working) return undefined
		const action = this.action
		if (!action) {
			return undefined
		}
		const startPos = toAxialCoord(character ? character.position : this.tile.position)
		const hex = this.tile.game.hex
		const searchDistance = character ? maxWalkTime : 6

		// Helper to find deposit with priority
		const findDeposit = (priority: 'clearing' | 'any') => {
			const searchFn = (coord: Positioned) => {
				const tile = hex.getTile(coord)
				if (!tile) {
					return false
				}
				const content = tile.content
				if (!(content instanceof UnBuiltLand)) {
					return false
				}
				if (content?.deposit?.name !== action.deposit) {
					return false
				}

				return priority === 'clearing' ? tile.clearing : tile.zone === 'harvest'
			}

			return hex.findNearest(startPos, searchFn, searchDistance, false)
		}

		let path = findDeposit('clearing')
		if (path) {
			return {
				job: 'harvest',
				path,
				urgency: 2.5,
				fatigue:
					this.getFatigueCost() +
					(character ? axialDistance(startPos, path[path.length - 1]!) * 2 : 0),
			}
		}

		// For regular harvesting, only offer if harvester can store
		if (!this.canStoreInHarvester) {
			return undefined
		}

		path = findDeposit('any')
		if (path) {
			return {
				job: 'harvest',
				path,
				urgency: (this.alveoliNeedingGood ? 0.5 : 0) + 0.25,
				fatigue:
					this.getFatigueCost() +
					(character ? axialDistance(startPos, path[path.length - 1]!) * 2 : 0),
			}
		}

		return undefined
	}
}
