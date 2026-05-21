import { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import {
	type FreightLineDefinition,
	findGatherFreightLines,
	gatherSelectableGoodTypes,
} from 'ssh/freight/freight-line'
import { FREIGHT_LINE_ALL_GOOD_TYPES } from 'ssh/freight/goods-selection-policy'
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

	private hiveStorageCanAccept(goodType: GoodType): boolean {
		return this.hive.generalStorages.some((storage) => {
			const acceptedRoomFor = (
				storage as {
					acceptedRoomFor?: (goodType: GoodType, priority: '0-store') => number
				}
			).acceptedRoomFor
			if (acceptedRoomFor) return acceptedRoomFor.call(storage, goodType, '0-store') > 0
			return storage.canTake(goodType, '0-store') && (storage.storage.hasRoom(goodType) ?? 0) > 0
		})
	}

	get hasLooseGoodsToGather(): boolean {
		const hiveNeeds = Object.keys(this.hive.needs) as GoodType[]
		for (const line of this.gatherFreightLines()) {
			const zoneStop = gatherZoneLoadStopForBay(line, this)
			if (!zoneStop) continue
			const acceptedGoods = gatherSelectableGoodTypes(line, FREIGHT_LINE_ALL_GOOD_TYPES).filter(
				(good) => this.hiveStorageCanAccept(good)
			)
			const pick = pickGatherTargetInZoneStop(
				this.tile.game,
				line,
				zoneStop,
				this.tile.position,
				[...new Set([...hiveNeeds, ...acceptedGoods])],
				{
					bayAlveolus: this,
					canAcceptGood: (good) => this.hiveStorageCanAccept(good),
				}
			)
			if (pick) return true
		}
		return false
	}
}
