import { memoize } from 'mutts'
import { maxWalkTime, outputBufferSize } from '$assets/constants'
import type { Character } from '$lib/game/population/character'
import { SpecificStorage } from '$lib/game/storage'
import type { HarvestJob } from '$lib/types/base'
import { axialDistance, type Positioned, toAxialCoord } from '../../utils/position'
import { UnBuiltLand } from '../board'
import { multiplyGoodsQty } from '../board/content/utils'
import type { Tile } from '../board/tile'
import { TransitAlveolus } from './transit'
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
			}),
		)
	}

	@memoize
	get canStoreInHarvester() {
		return this.storage.canStoreAll(this.action.output)
	}
	@memoize
	get hiveHasCollector() {
		return this.hive.byActionType.gather?.length
	}
	@memoize
	get alveoliNeedingGood() {
		return Object.keys(this.action.output).reduce(
			(acc, goodType) => acc + (goodType in this.hive.needs ? 1 : 0),
			0,
		)
	}
	// nextJob() replaces both alveolusSpecificJob() and keepWorking
	// Returns detailed job info including path when called from character
	nextJob(character?: Character): HarvestJob | undefined {
        console.error(`[Harvest] nextJob called. Working: ${this.working}, Action: ${this.action.type}, Deposit: ${this.action.deposit}`);
		if (!this.working) return undefined
		const startPos = toAxialCoord(character ? character.position : this.tile.position)
		const hex = this.tile.game.hex
		const searchDistance = character ? maxWalkTime : 6

		// Helper to find deposit with priority
		const findDeposit = (priority: 'clearing' | 'any') => {
			const searchFn = (coord: Positioned) => {
				const tile = hex.getTile(coord)
				if (!(tile?.content instanceof UnBuiltLand)) {
                    console.error(`[Harvest] Tile ${toAxialCoord(coord)} not UnBuiltLand. Content: ${tile?.content?.constructor.name}`);
                    return false
                }
				if (tile.content.deposit?.name !== this.action.deposit) {
                    if (tile.content.deposit) {
                        console.error(`[Harvest] Tile ${toAxialCoord(coord).q},${toAxialCoord(coord).r} deposit mismatch. Expected: ${this.action.deposit}, Found: ${tile.content.deposit?.name}`);
                    }
                    return false
                }

                if (toAxialCoord(coord).q === 2 && toAxialCoord(coord).r === 3) {
                    console.error(`[Harvest] searchFn checking 2,3. Content: ${tile.content?.constructor.name}, Clearing: ${tile.clearing}, Zone: ${tile.zone}, Priority: ${priority}`);
                }

				return priority === 'clearing' ? tile.clearing : tile.zone === 'harvest'
			}

			return hex.findNearest(startPos, searchFn, searchDistance, false)
		}

        // Debug check specific tile 2,3
        const debugTile = hex.getTile({q:2, r:3});
        if (debugTile) {
            console.error(`[Harvest] DEBUG TILE 2,3: content=${debugTile.content?.constructor.name}, deposit=${debugTile.content instanceof UnBuiltLand ? debugTile.content.deposit?.name : 'N/A'}`);
        }

		let path = findDeposit('clearing')
		if (path) {
            console.error(`[Harvest] check 1 (clearing) found path: ${path.length}`);
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
             console.error(`[Harvest] check 2 blocked: cannot store in harvester`);
             return undefined
        }

		path = findDeposit('any')
		if (path) {
             console.error(`[Harvest] check 3 (any) found path: ${path.length}`);
			return {
				job: 'harvest',
				path,
				urgency: (this.alveoliNeedingGood ? 0.5 : 0) + 0.25,
				fatigue:
					this.getFatigueCost() +
					(character ? axialDistance(startPos, path[path.length - 1]!) * 2 : 0),
			}
		}

        console.error(`[Harvest] nextJob returning undefined`);
		return undefined
	}
}
