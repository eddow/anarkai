import { jobBalance } from 'engine-rules'
import { inert, reactive } from 'mutts'
import { Alveolus } from 'ssh/board/content/alveolus'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { Tile } from 'ssh/board/tile'
import type { Character } from 'ssh/population/character'
import { residentialBasicDwellingProject } from 'ssh/residential/constants'
import { SlottedStorage } from 'ssh/storage/slotted-storage'
import type { ConstructJob, FoundationJob } from 'ssh/types/base'
import type { GoodsRelations } from 'ssh/utils/advertisement'
import { toAxialCoord } from 'ssh/utils/position'
import { traces } from '../dev/debug.ts'
import { buildAlveolusMarker } from './build-marker'

function isUndestroyedReadyBuildAlveolus(content: unknown): boolean {
	if (!content || typeof content !== 'object') return false
	if (!(buildAlveolusMarker in content)) return false
	if (!('isReady' in content) || !('destroyed' in content)) return false
	const ready = Reflect.get(content, 'isReady')
	const destroyed = Reflect.get(content, 'destroyed')
	return ready === true && destroyed === false
}

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

	@inert
	nextJob(character?: Character): ConstructJob | FoundationJob | undefined {
		if (!this.working) return undefined
		const hex = this.tile.game.hex
		const startPos = character ? toAxialCoord(character.position) : toAxialCoord(this.tile.position)

		// Prefer finishing ready build shells (including dwellings) over starting new foundations.
		// A single combined nearest-search can starve farther construction sites when nearer
		// foundation-only tiles exist within the engineer radius.
		const constructPath = hex.findNearest(
			startPos,
			(coord) => {
				const tile = hex.getTile(coord)
				return Boolean(tile?.content && isUndestroyedReadyBuildAlveolus(tile.content))
			},
			this.action.radius,
			true
		)

		if (constructPath) {
			const terminal = constructPath[constructPath.length - 1]
			const terminalTile = terminal ? hex.getTile(terminal) : undefined
			const c = terminalTile?.content
			if (c instanceof BuildDwelling) {
				traces.residential.log?.('[engineer] nextJob', {
					job: 'construct',
					fromQ: startPos?.q,
					fromR: startPos?.r,
					radius: this.action.radius,
					targetQ: terminal?.q,
					targetR: terminal?.r,
					tier: c.targetTier,
				})
			}
			return {
				job: 'construct',
				path: character ? constructPath : undefined,
				urgency: jobBalance.engineer.construct,
				fatigue: this.getFatigueCost(),
			}
		}

		const foundationPath = hex.findNearest(
			startPos,
			(coord) => {
				const tile = hex.getTile(coord)
				return Boolean(
					tile?.content instanceof UnBuiltLand && !!tile.content.project && tile.isClear
				)
			},
			this.action.radius,
			true
		)

		if (foundationPath) {
			const terminal = foundationPath[foundationPath.length - 1]
			const terminalTile = terminal ? hex.getTile(terminal) : undefined
			const land = terminalTile?.content
			if (land instanceof UnBuiltLand && land.project === residentialBasicDwellingProject) {
				traces.residential.log?.('[engineer] nextJob', {
					job: 'foundation',
					fromQ: startPos?.q,
					fromR: startPos?.r,
					radius: this.action.radius,
					targetQ: terminal?.q,
					targetR: terminal?.r,
					project: land.project,
				})
			}
			return {
				job: 'foundation',
				path: character ? foundationPath : undefined,
				urgency: jobBalance.engineer.foundation,
				fatigue: 3,
			}
		}

		return undefined
	}

	get workingGoodsRelations(): GoodsRelations {
		return {}
	}
}
