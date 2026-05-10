import { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import {
	type FreightLineDefinition,
	type FreightStop,
	type FreightZoneDefinitionRadius,
	findGatherFreightLines,
} from 'ssh/freight/freight-line'
import {
	gatherZoneLoadStopForBay,
	pickGatherTargetInZoneStop,
} from 'ssh/freight/freight-zone-gather-target'
import { NoStorage } from 'ssh/storage/no-storage'
import type { GoodType } from 'ssh/types/base'
import type { GoodsRelations } from 'ssh/utils/advertisement'

export class FreightBayAlveolus extends Alveolus {
	declare action: Ssh.RoadFretAction

	constructor(tile: Tile, definition: Ssh.AlveolusDefinition, resourceName: string) {
		if (definition.action.type !== 'road-fret') {
			throw new Error(
				`FreightBayAlveolus created with invalid action type: ${definition.action.type}`
			)
		}
		super(tile, new NoStorage())
		this.assignGameContent(definition, resourceName)
	}

	override canTake(_goodType: GoodType): boolean {
		return false
	}

	override canGive(_goodType: GoodType): boolean {
		return false
	}

	get workingGoodsRelations(): GoodsRelations {
		return {}
	}

	private gatherFreightLines(): FreightLineDefinition[] {
		const freightLines = this.tile?.game?.freightLines
		if (!freightLines?.length) return []
		return findGatherFreightLines(freightLines, this)
	}

	get hasLooseGoodsToGather(): boolean {
		const hiveNeeds = Object.keys(this.hive.needs) as GoodType[]
		for (const line of this.gatherFreightLines()) {
			const zoneStop = gatherZoneLoadStopForBay(line, this)
			if (!zoneStop) continue
			const pick = pickGatherTargetInZoneStop(
				this.tile.game,
				line,
				zoneStop as FreightStop & { zone: FreightZoneDefinitionRadius },
				this.tile.position,
				hiveNeeds,
				{
					bayAlveolus: this,
					canAcceptGood: (good) => this.hive.needs[good] !== undefined,
				}
			)
			if (pick) return true
		}
		return false
	}
}
