import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { Tile } from 'ssh/board/tile'
import {
	effectiveRemainingNeeds,
	isStandaloneConstructionSiteShell,
	materialRemainingNeeds,
} from 'ssh/build-site'
import {
	distributeSegmentAllowsTile,
	distributeSegmentWithinRadius,
	type FreightDistributeRouteSegment,
	type FreightLineDefinition,
	freightZoneTiles,
} from 'ssh/freight/freight-line'
import type { FreightAdSource } from 'ssh/freight/priority-channel'
import type { Game } from 'ssh/game/game'
import type { Storage } from 'ssh/storage'
import type { GoodType } from 'ssh/types/base'
import { type AxialCoord, axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'

/** @deprecated Prefer {@link isStandaloneConstructionSiteShell} from `ssh/build-site`. */
export const isStandaloneFreightConstructionSite = isStandaloneConstructionSiteShell

/** Channel used when a freight candidate is driven by a temporary / project-local construction sink. */
export const CONSTRUCTION_DEMAND_AD_SOURCE: FreightAdSource = 'project'

export interface FreightConstructionDemandTarget {
	readonly storage: Storage
	readonly remainingNeeds: Partial<Record<GoodType, number>>
	/** Needs with in-transit vehicle reservations subtracted (load-decision view). */
	readonly effectiveRemainingNeeds: Partial<Record<GoodType, number>>
	readonly destroyed: boolean
	readonly isReady: boolean
}

export function freightConstructionDemandTarget(
	content: unknown
): FreightConstructionDemandTarget | undefined {
	if (isStandaloneConstructionSiteShell(content)) {
		return {
			storage: content.storage,
			remainingNeeds: content.remainingNeeds as Partial<Record<GoodType, number>>,
			effectiveRemainingNeeds: effectiveRemainingNeeds(content) as Partial<Record<GoodType, number>>,
			destroyed: content.destroyed,
			isReady: content.isReady,
		}
	}
	if (!(content instanceof UnBuiltLand)) return undefined
	if (!content.project || !content.constructionSite || !content.foundationStorage) return undefined
	const remainingNeeds = materialRemainingNeeds(
		content.constructionSite.foundationRequiredGoods,
		content.foundationStorage
	) as Partial<Record<GoodType, number>>
	return {
		storage: content.foundationStorage,
		remainingNeeds,
		effectiveRemainingNeeds: remainingNeeds,
		destroyed: false,
		isReady: Object.keys(remainingNeeds).length === 0,
	}
}

/**
 * Visits each in-progress standalone construction tile whose axial distance from `bayPos` satisfies
 * {@link distributeSegmentWithinRadius} for the segment (same metric as bay requisition).
 */
export function visitStandaloneConstructionSitesForDistributeSegmentAxial(
	game: Game,
	line: FreightLineDefinition,
	segment: FreightDistributeRouteSegment,
	bayPos: AxialCoord,
	visitor: (tile: Tile, site: FreightConstructionDemandTarget) => void
): void {
	const unloadStop = line.stops[segment.unloadStopIndex]
	const tiles =
		unloadStop && 'zone' in unloadStop
			? unloadStop.zone.kind === 'radius'
				? game.hex.tilesAround(bayPos, unloadStop.zone.radius)
				: freightZoneTiles(game, unloadStop.zone)
			: game.hex.tiles
	for (const tile of tiles) {
		const c = freightConstructionDemandTarget(tile.content)
		if (!c || c.destroyed || c.isReady) continue
		const tilePos = toAxialCoord(tile.position)
		if (!tilePos) continue
		if (!distributeSegmentWithinRadius(line, segment, axial.distance(bayPos, tilePos))) continue
		if (!distributeSegmentAllowsTile(game, line, segment, tile)) continue
		visitor(tile, c)
	}
}
