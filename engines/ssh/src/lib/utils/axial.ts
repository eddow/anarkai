/**
 * @link https://www.redblobgames.com/grids/hexagons/
 */
import type { Sextuplet } from 'ssh/src/types'
import { assert } from 'ssh/src/lib/debug'
import type { RandGenerator } from './numbers'

export type AxialKey = string
export const AxialKey = 'string'
export interface AxialCoord {
	q: number
	r: number
}
export interface WorldCoord {
	x: number
	y: number
}
export interface Axial extends AxialCoord {
	key: AxialKey
}
export type AxialRef = AxialKey | AxialCoord | Axial

/**
 * Position in a triangle: side of the triangle and [u,v] where u+v<=1
 */
export interface Triangular {
	/**
	 * Side: [0..6[
	 */
	s: number
	u: number
	v: number
}

/**
 * null = on center
 * 0-5 = on edge
 */
export type AxialDirection = null | 0 | 1 | 2 | 3 | 4 | 5

export type Rotation = (c: AxialCoord) => AxialCoord

/** Rotations for 0, 60, 120, 180, 240 and 300° */
export const rotations: Rotation[] = [
	({ q, r }) => ({ q, r }),
	({ q, r }) => ({ q: q + r, r: -q }),
	({ q, r }) => ({ q: r, r: -q - r }),
	({ q, r }) => ({ q: -q, r: -r }),
	({ q, r }) => ({ q: -q - r, r: q }),
	({ q, r }) => ({ q: -r, r: q + r }),
]

export const hexSides = rotations.map((c) => c({ q: 1, r: 0 }))
/**
 * Retrieve the number of hexagon tiles in a complete hexagonal board of size radius
 */
export function hexTiles(radius: number) {
	return radius === 0 ? 0 : 3 * radius * (radius - 1) + 1
}

export function cartesian(aRef: AxialRef, size = 1) {
	const { q, r } = axial.access(aRef)
	const A = Math.sqrt(3) * size
	const B = (Math.sqrt(3) / 2) * size
	const C = (3 / 2) * size

	return { x: A * q + B * r, y: C * r }
}

export function fromCartesian({ x, y }: WorldCoord, size: number) {
	const A = Math.sqrt(3) * size
	const B = (Math.sqrt(3) / 2) * size
	const C = (3 / 2) * size

	const r = y / C
	const q = (x - B * r) / A
	return { q, r }
}

/**
 * Get all axial coordinates in a hexagonal rectangular selection defined by two points
 * Uses 3-symmetric cubic coordinate bounds (q, r, s) for a more natural hexagonal shape
 * Returns coordinates where q_min ≤ q ≤ q_max AND r_min ≤ r ≤ r_max AND s_min ≤ s ≤ s_max
 * @param start Starting axial point
 * @param end Ending axial point
 * @returns Array of all axial coordinates in the selection
 */
export function axialRectangle(start: AxialRef, end: AxialRef): AxialCoord[] {
	const startCoord = axial.coord(start)
	const endCoord = axial.coord(end)

	// Convert to cubic coordinates (q, r, s where s = -q - r)
	const startS = -startCoord.q - startCoord.r
	const endS = -endCoord.q - endCoord.r

	// Find min/max for all 3 cubic axes
	const minQ = Math.min(startCoord.q, endCoord.q)
	const maxQ = Math.max(startCoord.q, endCoord.q)
	const minR = Math.min(startCoord.r, endCoord.r)
	const maxR = Math.max(startCoord.r, endCoord.r)
	const minS = Math.min(startS, endS)
	const maxS = Math.max(startS, endS)

	const coords: AxialCoord[] = []

	// Iterate through the bounding box in q and r
	for (let q = minQ; q <= maxQ; q++) {
		for (let r = minR; r <= maxR; r++) {
			const s = -q - r
			// Check if s is within bounds (3rd axis constraint)
			if (s >= minS && s <= maxS) {
				coords.push({ q, r })
			}
		}
	}

	return coords
}

/**
 * Test if a world point is inside a hexagonal tile
 * @param point - World coordinates to test
 * @param coord - Axial coordinates of the tile
 * @param size - Size of the hexagon (radius from center to corner)
 * @returns true if the point is inside the hexagon
 */
export function pointInHex(point: WorldCoord, coord: AxialRef, size: number): boolean {
	// Convert world point to axial coordinates
	const pointAxial = fromCartesian(point, size)

	// Get the tile's axial coordinates
	const { q, r } = axial.access(coord)

	// Check if the point is within the tile's bounds using axial distance
	// A point is inside a hexagon if its distance from the center is <= 0.5
	// (since size represents the radius from center to corner)
	return axial.distance(pointAxial, { q, r }) <= 0.5
}

/**
 * Generate uniformly a valid {s,u,v} position in a tile
 * @returns {s,u,v}
 */
export function genTilePosition(gen: RandGenerator, radius = 1) {
	let [u, v] = [gen(radius), gen(radius)]
	const s = Math.floor(gen(6))
	if (u + v > radius) [u, v] = [radius - u, radius - v]
	return { s, u, v }
}

/**
 * Get a {s,u,v} position in a tile
 * * s is the side index [0,6[
 * * u,v are the coordinates in the triangle for that side
 * @param aRef
 * @param radius Specified virtual "radius" of the tile (subdivisions of the tile this function works with)
 * @returns {s,u,v}
 */
export function posInTile(aRef: AxialRef, radius: number) {
	if (axial.zero(aRef)) return { s: 0, u: 0, v: 0 }
	const coord = axial.coord(aRef)
	const outerRadius = radius + 0.5
	const { q, r } = { q: coord.q / outerRadius, r: coord.r / outerRadius }
	const s = -q - r
	const signs = (q >= 0 ? 'Q' : 'q') + (r >= 0 ? 'R' : 'r') + (s >= 0 ? 'S' : 's')
	return {
		Qrs: { s: 0, u: -r, v: -s },
		QrS: { s: 1, u: s, v: q },
		qrS: { s: 2, u: -q, v: -r },
		qRS: { s: 3, u: r, v: s },
		qRs: { s: 4, u: -s, v: -q },
		QRs: { s: 5, u: q, v: r },
	}[signs]!
}

function bitShiftUnpair(z: number): AxialCoord {
	const rv = { q: z >> 16, r: z & 0xffff }
	if (rv.r > 32767) rv.r -= 65536
	return rv
}

export const axial = {
	access(aRef: AxialRef): Axial {
		if (typeof aRef === 'string') return axial.keyAccess(aRef)
		return axial.coordAccess(aRef)
	},
	keyAccess(aRef: AxialKey): Axial {
		return {
			key: aRef,
			...axial.coord(aRef),
		}
	},
	coordAccess(aRef: AxialCoord): Axial {
		assert(typeof aRef === 'object', 'aRef must be an object')
		assert(!('key' in aRef) || aRef.key !== undefined, 'key must be defined if set')
		if ('key' in aRef) return aRef as Axial
		return Object.assign(aRef, {
			//key: bitShiftPair(aRef),
			key: `${aRef.q},${aRef.r}`,
		})
	},
	/**
	 * Get the axial-ref as an axial: an object `{q, r}`
	 * @returns AxialCoord
	 */
	coord(aRef: AxialRef | string): AxialCoord {
		switch (typeof aRef) {
			case 'number':
				return bitShiftUnpair(aRef)
			case 'string': {
				const [q, r] = aRef.split(',').map(Number)
				return { q, r }
			}
			default:
				return aRef
		}
	},
	/**
	 * Get the axial-ref as a key
	 * @returns string
	 */
	key(aRef: AxialRef | string): AxialKey {
		switch (
			typeof aRef /*
			case 'number':
				return aRef
			case 'string':
				return bitShiftPair(axial.coord(aRef))*/
		) {
			case 'string':
				return aRef
			default:
				return axial.coordAccess(aRef as Axial).key // cache it
		}
	},

	toString(aRef: Axial) {
		const { q, r } = axial.access(aRef)
		return `<${q} ${r}>`
	},

	/**
	 * Addition a list of axial coordinates optionally with a scalar coefficient
	 * @param args [coef, AxialRef] Scalar coefficient and axial to multiply/add
	 * @param args AxialRef Axial to add
	 * @returns AxialCoord
	 */
	linear(...args: ([number, AxialRef] | AxialRef)[]): AxialCoord {
		return args.reduce<AxialCoord>(
			(acc, term) => {
				const [coef, aRef] = Array.isArray(term) ? term : [1, term]
				const { q, r } = axial.coord(aRef)
				return { q: acc.q + coef * q, r: acc.r + coef * r }
			},
			{ q: 0, r: 0 },
		)
	},
	/**
	 * Retrieves if the axial is at 0,0
	 * @returns boolean
	 */
	zero(aRef: AxialRef) {
		if (typeof aRef !== 'object') return aRef === '0,0'
		const { q, r } = axial.coord(aRef)
		return q === 0 && r === 0
	},

	round({ q, r }: AxialCoord) {
		const v = [q, r, -q - r]
		const round = v.map(Math.round)
		const diff = v.map((v, i) => Math.abs(round[i] - v))
		const [rq, rr, rs] = round

		return [
			{ q: -rr - rs, r: rr },
			{ q: rq, r: -rq - rs },
			{ q: rq, r: rr },
		][diff.indexOf(Math.max(...diff))]
	},

	distance(a: AxialCoord, b: AxialCoord = { q: 0, r: 0 }) {
		const aS = -a.q - a.r
		const bS = -b.q - b.r
		return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(aS - bS))
	},

	/**
	 * For 2 neighbors, returns the 2 orthogonal neighbors: the 2 points who are common neighbors
	 * @param ARef
	 * @param BRef
	 * @returns
	 */
	orthogonal(ARef: AxialRef, BRef: AxialRef): [AxialCoord, AxialCoord] {
		const sideAxial = axial.linear(ARef, [-1, BRef])
		const side = hexSides.findIndex(({ q, r }) => q === sideAxial.q && r === sideAxial.r)
		assert(side !== -1, 'Orthogonal: Points must be neighbors')
		return [
			axial.linear(BRef, hexSides[(side + 1) % 6]),
			axial.linear(BRef, hexSides[(side + 5) % 6]),
		]
	},
	/**
	 * Enumerate all hex coordinates within a given distance
	 * @param maxAxialDistance 0 = 1 hex, 1 = 7 hex (central + 6 surrounding), 2 = 19 hex...
	 */
	*enum(maxAxialDistance: number) {
		for (let q = -maxAxialDistance; q <= maxAxialDistance; q++) {
			for (
				let r = Math.max(-maxAxialDistance, -q - maxAxialDistance);
				r <= Math.min(maxAxialDistance, -q + maxAxialDistance);
				r++
			)
				yield { q, r }
		}
	},

	/**
	 * Enumerate all hex coordinates within a given radius from a center point
	 * @param center The center axial coordinate
	 * @param radius The radius to search within
	 */
	*allTiles(center: AxialCoord, radius: number): Generator<AxialCoord> {
		for (const offset of axial.enum(radius)) {
			yield axial.linear(center, offset)
		}
	},

	/**
	 * Retrieves the tiles around a given tile
	 * @returns AxialCoord[]
	 */
	neighbors(aRef: AxialRef): Sextuplet<AxialCoord> {
		return hexSides.map((side) => axial.linear(aRef, side)) as Sextuplet<AxialCoord>
	},
	neighborIndex(coord: AxialCoord, from?: AxialCoord) {
		if (from) coord = axial.linear(coord, [-1, from])
		return neighborIndexes[coord.q * 3 + coord.r + 4]
	},
	randomPositionInTile(gen: RandGenerator, size: number = 1) {
		const { s, u, v } = genTilePosition(gen, size / 2)
		const angle = Math.PI / 3
		return {
			x: Math.cos(s * angle) * u + Math.cos((s + 1) * angle) * v,
			y: Math.sin(s * angle) * u + Math.sin((s + 1) * angle) * v,
		}
	},
}
const neighborIndexes: (AxialDirection | undefined)[] = [
	undefined, // q-1 r-1
	3, // q-1 r 0
	2, // q-1 r+1
	4, // q 0 r-1
	undefined, // q 0 r 0
	1, // q 0 r+1
	5, // q+1 r-1
	0, // q+1 r 0
	undefined, // q+1 r+1
]

//@ts-expect-error - this is only for debug purpose anyway
if (typeof window !== 'undefined') window.axial = axial
