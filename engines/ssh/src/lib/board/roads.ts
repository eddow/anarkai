import type { Tile } from 'ssh/board/tile'
import type { AxialCoord } from 'ssh/utils'
import { axial } from 'ssh/utils/axial'
import { toAxialCoord } from 'ssh/utils/position'

export type RoadType = 'path'

export interface RoadPatch {
	coord: readonly [number, number]
	type: RoadType
}

export interface RoadSegment {
	coord: AxialCoord
	type: RoadType
}

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

export function straightRoadTileTrace(start: Tile, end: Tile): Tile[] {
	const board = start.board
	const coords = straightRoadCoords(
		axial.round(toAxialCoord(start.position)!),
		axial.round(toAxialCoord(end.position)!)
	)
	return coords.map((coord) => board.getTile(coord)).filter((tile): tile is Tile => !!tile)
}

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
