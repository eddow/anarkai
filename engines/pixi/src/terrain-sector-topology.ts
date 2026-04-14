import { Rectangle } from 'pixi.js'
import { type AxialCoord, axial, cartesian } from 'ssh/utils'
import { tileSize } from 'ssh/utils/varied'

const SECTOR_STEP = 17
const HEX_HALF_WIDTH = (Math.sqrt(3) / 2) * tileSize
const HEX_HALF_HEIGHT = tileSize

const NEIGHBOR_DIRECTIONS: AxialCoord[] = [
	{ q: 1, r: 0 },
	{ q: 1, r: -1 },
	{ q: 0, r: -1 },
	{ q: -1, r: 0 },
	{ q: -1, r: 1 },
	{ q: 0, r: 1 },
]

export interface SectorCoverage {
	sectorKey: string
	interiorTileCoords: AxialCoord[]
	bakeTileCoords: AxialCoord[]
	displayBounds: Rectangle
}

export function sectorKeyForCoord(coord: AxialCoord, sectorStep = SECTOR_STEP): string {
	return `${Math.floor(coord.q / sectorStep)},${Math.floor(coord.r / sectorStep)}`
}

export function coordsForSectorInterior(sectorKey: string, sectorStep = SECTOR_STEP): AxialCoord[] {
	const [q, r] = sectorKey.split(',').map(Number)
	const start = { q: q * sectorStep, r: r * sectorStep }
	const end = { q: start.q + sectorStep - 1, r: start.r + sectorStep - 1 }
	return axialRectangle(start, end)
}

export function coordsForSectorBakeDomain(
	sectorKey: string,
	sectorStep = SECTOR_STEP
): AxialCoord[] {
	const interior = coordsForSectorInterior(sectorKey, sectorStep)
	const expanded = new Map<string, AxialCoord>()

	for (const coord of interior) {
		expanded.set(axial.key(coord), coord)
		for (const direction of NEIGHBOR_DIRECTIONS) {
			const neighbor = { q: coord.q + direction.q, r: coord.r + direction.r }
			expanded.set(axial.key(neighbor), neighbor)
		}
	}

	return [...expanded.values()]
}

export function sectorsAffectedByTile(coord: AxialCoord, sectorStep = SECTOR_STEP): string[] {
	const sectorKeys = new Set<string>()
	const candidates = new Map<string, AxialCoord>()

	candidates.set(axial.key(coord), coord)
	for (const direction of NEIGHBOR_DIRECTIONS) {
		const neighbor = { q: coord.q + direction.q, r: coord.r + direction.r }
		candidates.set(axial.key(neighbor), neighbor)
	}

	for (const candidate of candidates.values()) {
		sectorKeys.add(sectorKeyForCoord(candidate, sectorStep))
	}

	return [...sectorKeys].filter((sectorKey) => {
		const bakeDomain = coordsForSectorBakeDomain(sectorKey, sectorStep)
		return bakeDomain.some((tile) => tile.q === coord.q && tile.r === coord.r)
	})
}

export function computeSectorDisplayBounds(sectorKey: string, sectorStep = SECTOR_STEP): Rectangle {
	const interior = coordsForSectorInterior(sectorKey, sectorStep)
	return computeWorldBounds(interior)
}

export function createSectorCoverage(sectorKey: string, sectorStep = SECTOR_STEP): SectorCoverage {
	return {
		sectorKey,
		interiorTileCoords: coordsForSectorInterior(sectorKey, sectorStep),
		bakeTileCoords: coordsForSectorBakeDomain(sectorKey, sectorStep),
		displayBounds: computeSectorDisplayBounds(sectorKey, sectorStep),
	}
}

function computeWorldBounds(coords: AxialCoord[]): Rectangle {
	let minX = Number.POSITIVE_INFINITY
	let minY = Number.POSITIVE_INFINITY
	let maxX = Number.NEGATIVE_INFINITY
	let maxY = Number.NEGATIVE_INFINITY

	for (const coord of coords) {
		const world = cartesian(coord, tileSize)
		minX = Math.min(minX, world.x - HEX_HALF_WIDTH)
		maxX = Math.max(maxX, world.x + HEX_HALF_WIDTH)
		minY = Math.min(minY, world.y - HEX_HALF_HEIGHT)
		maxY = Math.max(maxY, world.y + HEX_HALF_HEIGHT)
	}

	if (!Number.isFinite(minX)) return new Rectangle(0, 0, 0, 0)
	return new Rectangle(minX, minY, Math.max(0, maxX - minX), Math.max(0, maxY - minY))
}

function axialRectangle(start: AxialCoord, end: AxialCoord): AxialCoord[] {
	const coords: AxialCoord[] = []
	for (let q = start.q; q <= end.q; q++) {
		for (let r = start.r; r <= end.r; r++) {
			coords.push({ q, r })
		}
	}
	return coords
}

export const terrainSectorStep = SECTOR_STEP
export const terrainNeighborDirections = NEIGHBOR_DIRECTIONS
