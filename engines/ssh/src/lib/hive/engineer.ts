import { reactive } from 'mutts'
import { Alveolus } from 'ssh/src/lib/board/content/alveolus'
import { UnBuiltLand } from 'ssh/src/lib/board/content/unbuilt-land'
import type { Tile } from 'ssh/src/lib/board/tile'
import { BuildAlveolus } from 'ssh/src/lib/hive/build'
import type { Character } from 'ssh/src/lib/population/character'
import { SlottedStorage } from 'ssh/src/lib/storage/slotted-storage'
import type { ConstructJob, FoundationJob } from 'ssh/src/lib/types/base'
import type { GoodsRelations } from 'ssh/src/lib/utils/advertisement'
import { toAxialCoord } from 'ssh/src/lib/utils/position'

@reactive
export class EngineerAlveolus extends Alveolus {
	declare action: Ssh.EngineerAction
	constructor(tile: Tile) {
		const def: Ssh.AlveolusDefinition = new.target.prototype
		if (def.action.type !== 'engineer') {
			throw new Error('EngineerAlveolus can only be created from an engineer action')
		}
		super(tile, new SlottedStorage(0, 0))
	}

	nextJob(character?: Character): ConstructJob | FoundationJob | undefined {
		if (!this.working) return undefined
		const hex = this.tile.game.hex
		const startPos = character ? toAxialCoord(character.position) : toAxialCoord(this.tile.position)

		// Find nearest site needing foundation or construction (whichever is closest)
		let jobType: 'foundation' | 'construct' | undefined
		const path = hex.findNearest(
			startPos,
			(coord) => {
				const tile = hex.getTile(coord)

				// Check for UnBuiltLand with clear project (needs foundation)
				if (tile?.content instanceof UnBuiltLand && !!tile.content.project && tile.isClear) {
					jobType = 'foundation'
					return true
				}

				// Check for BuildAlveolus ready to be built (needs construction)
				if (
					tile?.content instanceof BuildAlveolus &&
					tile.content.isReady &&
					!tile.content.destroyed
				) {
					jobType = 'construct'
					return true
				}

				return false
			},
			this.action.radius,
			true,
		)

		if (!path) return undefined

		// Return appropriate job based on what was found
		if (jobType === 'foundation') {
			return {
				job: 'foundation',
				path: character ? path : undefined,
				urgency: 3,
				fatigue: 3,
			}
		} else {
			return {
				job: 'construct',
				path: character ? path : undefined,
				urgency: 2,
				fatigue: this.getFatigueCost(),
			}
		}
	}

	get workingGoodsRelations(): GoodsRelations {
		return {}
	}
}
