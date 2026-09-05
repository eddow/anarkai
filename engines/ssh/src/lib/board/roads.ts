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

/** A preview ghost for a road border during placement authoring. */
export interface RoadPreviewEntry {
	coord: readonly [number, number]
	type: RoadType
	/** Non-empty when this road border collides (river / water / blocked tile). */
	blocked?: string
}

/**
 * Recover the two endpoint tile coordinates of a road border from its midpoint
 * coordinate. Border coords are `axial.linear([0.5, a], [0.5, b])` (the midpoint
 * between two adjacent tile centers), so they carry half-integer axial parts.
 * The parity of `2*q, 2*r` picks the perpendicular neighbour direction.
 */
export function roadBorderEndpointCoords(
	coord: readonly [number, number]
): [readonly [number, number], readonly [number, number]] {
	const dq = Math.round(coord[0] * 2)
	const dr = Math.round(coord[1] * 2)
	const qOdd = dq % 2 !== 0
	const rOdd = dr % 2 !== 0
	const q = dq / 2
	const r = dr / 2
	if (qOdd && !rOdd) {
		return [
			[q - 0.5, r],
			[q + 0.5, r],
		]
	}
	if (!qOdd && rOdd) {
		return [
			[q, r - 0.5],
			[q, r + 0.5],
		]
	}
	// Both half-integer: diagonal border.
	return [
		[q - 0.5, r + 0.5],
		[q + 0.5, r - 0.5],
	]
}

/**
 * The canonical **anchor tile** for a road border: the endpoint tile where road
 * construction/ demolition goods are delivered and where the road engineer stands
 * to work. Chosen deterministically (lexicographically-smaller endpoint) so every
 * road engineer resolves the same border to the same tile — the build side and the
 * demolition refund side are always the same, never split across both endpoints.
 */
export function roadBorderAnchorCoord(coord: readonly [number, number]): readonly [number, number] {
	const [a, b] = roadBorderEndpointCoords(coord)
	if (a[0] !== b[0]) return a[0] < b[0] ? a : b
	return a[1] <= b[1] ? a : b
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

/**
 * Whether a tile is a valid road **terminus**: a freight bay. A bay is the road's
 * dock, so a road may *end* at it — but never *cross through* it (its tile is a
 * building footprint, not passable ground).
 */
export function isRoadTerminusTile(tile: Tile): boolean {
	const content = tile.content
	return content instanceof Alveolus && content.action.type === 'road-fret'
}

/**
 * Whether a road trace may pass through this tile while being authored.
 *
 * `blocked` is an optional predicate for tiles that refuse a road even though
 * their board content is empty — used by project authoring so a road cannot be
 * planned on top of a planned alveolus. It receives `isTraceEndpoint` so a planned
 * freight bay (also a road terminus) is allowed to end a road, mirroring the board
 * rule in {@link isRoadTerminusTile}.
 */
export function canBuildRoadThroughTile(
	tile: Tile,
	blocked?: (tile: Tile, isTraceEndpoint: boolean) => boolean,
	isTraceEndpoint = false
): boolean {
	if (!isRoadCompatibleTerrain(tile)) return false
	if (tile.zone?.type === 'residential') return false
	if (blocked?.(tile, isTraceEndpoint)) return false
	const content = tile.content
	if (!content) return true
	if (content instanceof Alveolus) {
		// A freight bay may terminate a road; any other alveolus blocks entirely.
		return isTraceEndpoint && isRoadTerminusTile(tile)
	}
	if (content instanceof BasicDwelling) return false
	if (isConstructionSiteShell(content)) return false
	if (content instanceof UnBuiltLand) {
		if (content.site) return false
		return true
	}
	return true
}

/**
 * Validate the authored road trace.
 *
 * The highlighted tile trace is authoritative for build permission. Border conversion is only checked after
 * every tile has passed so invalid middle tiles cannot be bypassed by border ownership details.
 *
 * `blocked` is threaded through to {@link canBuildRoadThroughTile} for project-authored road collisions.
 */
export function canBuildRoadOnTrace(
	trace: readonly Tile[],
	blocked?: (tile: Tile, isTraceEndpoint: boolean) => boolean
): boolean {
	if (trace.length === 0) return false
	for (let i = 0; i < trace.length; i++) {
		const tile = trace[i]!
		const isEndpoint = i === 0 || i === trace.length - 1
		if (!canBuildRoadThroughTile(tile, blocked, isEndpoint)) return false
	}
	const borders = roadBordersForTrace(trace)
	if (trace.length > 1 && borders.length !== trace.length - 1) return false
	for (const border of borders) {
		if (!canBuildRoadAcrossBorder(border)) return false
	}
	return true
}
