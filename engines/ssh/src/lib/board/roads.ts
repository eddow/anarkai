import type { Tile } from 'ssh/board/tile'
import { Alveolus } from 'ssh/board/content/alveolus'
import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { isConstructionSiteShell } from 'ssh/build-site'
import type { AxialCoord } from 'ssh/utils'
import { axial } from 'ssh/utils/axial'
import { toAxialCoord } from 'ssh/utils/position'

export type RoadType = 'path'
export const ROAD_WALK_TIME_MULTIPLIER = 0.5

export interface RoadPatch {
	coord: readonly [number, number]
	type: RoadType
}

export type RoadPatches = Partial<Record<RoadType, ReadonlyArray<readonly [number, number]>>>
export type RoadPatchInput = RoadPatches | ReadonlyArray<RoadPatch>

export interface RoadSegment {
	coord: AxialCoord
	type: RoadType
}

/** Return the straightest adjacent tile-coordinate trace between two tile centers. */
export function straightRoadCoords(start: AxialCoord, end: AxialCoord): AxialCoord[] {
	const distance = axial.distance(start, end)
	if (distance === 0) return [axial.round(start)]

	const coords: AxialCoord[] = []
	let lastKey: string | undefined
	for (let i = 0; i <= distance; i++) {
		const t = i / distance
		const coord = axial.round(
			axial.linear([1 - t, start], [t, end])
		)
		const key = axial.key(coord)
		if (key !== lastKey) {
			coords.push(coord)
			lastKey = key
		}
	}
	return coords
}

/** Resolve a straight coordinate trace onto the board that owns the start tile. */
export function straightRoadTileTrace(start: Tile, end: Tile): Tile[] {
	const board = start.board
	const coords = straightRoadCoords(
		axial.round(toAxialCoord(start.position)!),
		axial.round(toAxialCoord(end.position)!)
	)
	return coords.map((coord) => board.getTile(coord)).filter((tile): tile is Tile => !!tile)
}

/** Convert a tile trace into the border coordinates that persist the resulting road segments. */
export function roadBordersForTrace(trace: readonly Tile[]) {
	const borders = []
	for (let i = 1; i < trace.length; i++) {
		const previous = trace[i - 1]
		const current = trace[i]
		const border = previous?.borderWith(current!)
		if (border) borders.push(border)
	}
	return borders
}

/** Whether a road trace may pass through this tile while being authored. */
export function canBuildRoadThroughTile(tile: Tile): boolean {
	if (tile.zone === 'residential') return false
	const content = tile.content
	if (!content) return true
	if (content instanceof Alveolus && content.action.type === 'road-fret') return true
	if (content instanceof Alveolus) return false
	if (content instanceof BasicDwelling) return false
	if (isConstructionSiteShell(content)) return false
	if (content instanceof UnBuiltLand) {
		if (content.project) return false
		return true
	}
	return true
}

/**
 * Validate the authored road trace.
 *
 * The highlighted tile trace is authoritative for build permission. Border conversion is only checked after
 * every tile has passed so invalid middle tiles cannot be bypassed by border ownership details.
 */
export function canBuildRoadOnTrace(trace: readonly Tile[]): boolean {
	if (trace.length === 0) return false
	for (const tile of trace) {
		if (!canBuildRoadThroughTile(tile)) return false
	}
	const borders = roadBordersForTrace(trace)
	if (trace.length > 1 && borders.length !== trace.length - 1) return false
	return true
}
