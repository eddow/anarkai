import { Alveolus } from 'ssh/board/content/alveolus'
import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { Tile } from 'ssh/board/tile'
import { isConstructionSiteShell } from 'ssh/build-site'
import type { TerrainHydrologyDirection } from 'ssh/game/terrain-provider'
import type { AxialCoord } from 'ssh/utils'
import { axial } from 'ssh/utils/axial'
import { toAxialCoord } from 'ssh/utils/position'
import type { TileBorder } from './border/border'

export type RoadType = 'path' | 'asphalt'
export const ROAD_TYPES = ['path', 'asphalt'] as const satisfies readonly RoadType[]
export const ROAD_WALK_TIME_MULTIPLIERS: Record<RoadType, number> = {
	path: 0.5,
	asphalt: 0.25,
}

export function isRoadType(value: string): value is RoadType {
	return (ROAD_TYPES as readonly string[]).includes(value)
}

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
		const coord = axial.round(axial.linear([1 - t, start], [t, end]))
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

function effectiveRoadTerrain(tile: Tile): string | undefined {
	const content = tile.content
	if (content instanceof UnBuiltLand) return content.terrain
	return tile.terrainState?.terrain ?? tile.baseTerrain
}

export function isRoadCompatibleTerrain(tile: Tile): boolean {
	return effectiveRoadTerrain(tile) !== 'water'
}

function hydrologyHasEdge(tile: Tile, direction: number): boolean {
	const edges = tile.hydrology?.edges
	if (!edges) return false
	return edges[direction as TerrainHydrologyDirection] !== undefined
}

function riverDirectionBetween(from: Tile, to: Tile): number | undefined {
	const fromCoord = toAxialCoord(from.position)
	const toCoord = toAxialCoord(to.position)
	if (!fromCoord || !toCoord) return undefined
	const direction = axial.neighborIndex(axial.linear(toCoord, [-1, fromCoord]))
	return typeof direction === 'number' ? direction : undefined
}

export function borderHasRiver(border: TileBorder): boolean {
	const aDirection = riverDirectionBetween(border.tile.a, border.tile.b)
	if (aDirection !== undefined && hydrologyHasEdge(border.tile.a, aDirection)) return true
	const bDirection = riverDirectionBetween(border.tile.b, border.tile.a)
	if (bDirection !== undefined && hydrologyHasEdge(border.tile.b, bDirection)) return true
	return false
}

export function canBuildRoadAcrossBorder(border: TileBorder): boolean {
	if (!isRoadCompatibleTerrain(border.tile.a) || !isRoadCompatibleTerrain(border.tile.b))
		return false
	return !borderHasRiver(border)
}

/** Whether a road trace may pass through this tile while being authored. */
export function canBuildRoadThroughTile(tile: Tile): boolean {
	if (!isRoadCompatibleTerrain(tile)) return false
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
	for (const border of borders) {
		if (!canBuildRoadAcrossBorder(border)) return false
	}
	return true
}
