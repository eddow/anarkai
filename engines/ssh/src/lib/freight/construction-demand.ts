import type { Tile } from 'ssh/board/tile'
import { type BuildSite, isStandaloneBuildSiteShell } from 'ssh/build-site'
import {
	distributeSegmentWithinRadius,
	type FreightDistributeRouteSegment,
	type FreightLineDefinition,
} from 'ssh/freight/freight-line'
import type { Game } from 'ssh/game/game'
import { type AxialCoord, axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'

/** @deprecated Prefer {@link isStandaloneBuildSiteShell} from `ssh/build-site`. */
export const isStandaloneFreightConstructionSite = isStandaloneBuildSiteShell

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
	for (const tile of game.hex.tiles) {
		const c = tile.content
		if (!isStandaloneBuildSiteShell(c)) continue
		if (c.destroyed || c.isReady) continue
		const tilePos = toAxialCoord(tile.position)
		if (!tilePos) continue
		if (!distributeSegmentWithinRadius(line, segment, axial.distance(bayPos, tilePos))) continue
		visitor(tile, c)
	}
}
