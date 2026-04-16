import type { Tile } from 'ssh/board/tile'
import { traces } from 'ssh/debug'
import { visitStandaloneConstructionSitesForDistributeSegmentAxial } from 'ssh/freight/construction-demand'
import {
	distributeSegmentAllowsGoodTypeForSegment,
	distributeSegmentBayTile,
	findDistributeRouteSegments,
} from 'ssh/freight/freight-line'
import type { Game } from 'ssh/game/game'
import type { GoodType } from 'ssh/types/base'
import type { GoodsRelations } from 'ssh/utils/advertisement'
import { toAxialCoord } from 'ssh/utils/position'

export interface FreightBayConstructionRequisitionTarget {
	readonly name: string
	readonly tile: Tile
	readonly storage: { available(goodType: GoodType): number }
}

/**
 * Adds `2-use` **demand** on a distribute-segment primary `freight_bay` so the hive will stock
 * goods needed by in-progress standalone construction shells (when the bay cannot already fulfill
 * pickup).
 */
export function augmentFreightBayGoodsRelationsForConstruction(
	game: Game,
	bay: FreightBayConstructionRequisitionTarget,
	relations: GoodsRelations
): void {
	if (bay.name !== 'freight_bay') return
	const freightLines = game.freightLines
	if (!freightLines?.length) return

	const bayPos = toAxialCoord(bay.tile.position)
	if (!bayPos) return

	for (const line of freightLines) {
		const segments = findDistributeRouteSegments(line)
		for (const segment of segments) {
			const segBayTile = distributeSegmentBayTile(game, line, segment)
			const segBayPos = segBayTile ? toAxialCoord(segBayTile.position) : undefined
			if (!segBayPos || segBayPos.q !== bayPos.q || segBayPos.r !== bayPos.r) continue

			const demanded: Partial<Record<GoodType, number>> = {}

			visitStandaloneConstructionSitesForDistributeSegmentAxial(
				game,
				line,
				segment,
				bayPos,
				(_tile, c) => {
					if (c.destroyed || c.isReady) return
					for (const goodType of Object.keys(c.remainingNeeds) as GoodType[]) {
						const need = c.remainingNeeds[goodType] ?? 0
						if (need <= 0) continue
						if (!distributeSegmentAllowsGoodTypeForSegment(line, segment, goodType)) continue
						demanded[goodType] = (demanded[goodType] ?? 0) + need
						const available = bay.storage.available(goodType) ?? 0
						const existing = relations[goodType]
						if (available >= 1 && existing?.advertisement === 'provide') continue
						relations[goodType] = { advertisement: 'demand', priority: '2-use' }
					}
				}
			)

			if (Object.keys(demanded).length > 0) {
				traces.residential?.log('[construction] freight-bay requisition', {
					lineId: line.id,
					bayQ: bayPos.q,
					bayR: bayPos.r,
					demanded,
				})
			}
		}
	}
}
