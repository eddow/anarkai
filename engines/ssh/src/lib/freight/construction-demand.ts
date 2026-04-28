import type { Tile } from 'ssh/board/tile'
import { type BuildSite, isStandaloneBuildSiteShell } from 'ssh/build-site'
import {
	distributeSegmentWithinRadius,
	type FreightDistributeRouteSegment,
	type FreightLineDefinition,
} from 'ssh/freight/freight-line'
import type { FreightAdSource } from 'ssh/freight/priority-channel'
import type { Game } from 'ssh/game/game'
import { type AxialCoord, axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'

/** @deprecated Prefer {@link isStandaloneBuildSiteShell} from `ssh/build-site`. */
export const isStandaloneFreightConstructionSite = isStandaloneBuildSiteShell

/** Channel used when a freight candidate is driven by a temporary / project-local construction sink. */
export const CONSTRUCTION_DEMAND_AD_SOURCE: FreightAdSource = 'project'

/**
 * Visits each in-progress standalone construction tile whose axial distance from `bayPos` satisfies
 * {@link distributeSegmentWithinRadius} for the segment (same metric as bay requisition).
 */
export function visitStandaloneConstructionSitesForDistributeSegmentAxial(
	game: Game,
	line: FreightLineDefinition,
	segment: FreightDistributeRouteSegment,
	bayPos: AxialCoord,
	visitor: (tile: Tile, site: BuildSite) => void
): void {
	const unloadStop = line.stops[segment.unloadStopIndex]
	const tiles =
		unloadStop && 'zone' in unloadStop && unloadStop.zone.kind === 'radius'
			? game.hex.tilesAround(bayPos, unloadStop.zone.radius)
			: game.hex.tiles
	for (const tile of tiles) {
		const c = tile.content
		if (!isStandaloneBuildSiteShell(c)) continue
		if (c.destroyed || c.isReady) continue
		const tilePos = toAxialCoord(tile.position)
		if (!tilePos) continue
		if (!distributeSegmentWithinRadius(line, segment, axial.distance(bayPos, tilePos))) continue
		visitor(tile, c)
	}
}
