import { jobBalance } from 'engine-rules'
import { inert } from 'mutts'
import type { Tile } from 'ssh/board/tile'
import { Alveolus } from 'ssh/board/content/alveolus'
import {
	canPlantTreeOnLand,
	type PlantedTreesState,
	plantTreeOnLand,
	UnBuiltLand,
} from 'ssh/board/content/unbuilt-land'
import { noStorage } from 'ssh/storage/no-storage'
import type { ForesterJob } from 'ssh/types/base'
import type { GoodsRelations } from 'ssh/utils/advertisement'
import { axialDistance, type Positioned, toAxialCoord } from 'ssh/utils/position'
import { maxWalkTime } from '../../../assets/constants'
import type { Character } from 'ssh/population/character'

export class ForesterAlveolus extends Alveolus {
	declare action: Ssh.PlantingAction

	constructor(tile: Tile, definition: Ssh.AlveolusDefinition, resourceName: string) {
		if (definition.action.type !== 'plant') {
			throw new Error('ForesterAlveolus can only be created from a plant action')
		}
		super(tile, noStorage)
		this.assignGameContent(definition, resourceName)
	}

	get workingGoodsRelations(): GoodsRelations {
		return {}
	}

	@inert
	protected override nextAlveolusJob(character?: Character): ForesterJob | undefined {
		if (!this.canProposeAlveolusSpecificJobs) return undefined
		if (this.action.deposit !== 'tree') return undefined
		if (this.assignedZoneIds.length === 0) return undefined

		const startPos = toAxialCoord(character ? character.position : this.tile.position)
		const hex = this.tile.game.hex
		const candidateCoords = this.assignedZoneIds.flatMap((zoneId) =>
			hex.zoneManager.coordsForZone(zoneId)
		)
		let bestPath: Positioned[] | undefined

		for (const coord of candidateCoords) {
			const tile = hex.getTile(coord)
			if (!(tile?.content instanceof UnBuiltLand)) continue
			if (!canPlantTreeOnLand(tile.content)) continue
			const path = character
				? hex.findPathForCharacter(startPos, coord, character, maxWalkTime, false)
				: hex.findPath(startPos, coord, maxWalkTime, false)
			if (!path) continue
			if (!bestPath || path.length < bestPath.length) bestPath = path
		}

		if (!bestPath) return undefined
		return {
			job: 'forester',
			path: bestPath,
			urgency: jobBalance.forester,
			fatigue:
				this.getFatigueCost() +
				(character ? axialDistance(startPos, bestPath[bestPath.length - 1]!) * 0.01 : 0),
		}
	}

	plantAtCurrentTile(character: Character): boolean {
		const content = character.tile.content
		return content instanceof UnBuiltLand ? plantTreeOnLand(content) : false
	}
}

export type { PlantedTreesState }
