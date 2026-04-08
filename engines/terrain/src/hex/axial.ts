/**
 * Core hex math for axial coordinate systems
 * @link https://www.redblobgames.com/grids/hexagons/
 */

import type {
	Axial,
	AxialCoord,
	AxialDirection,
	AxialKey,
	AxialRef,
	Rotation,
	Sextuplet,
	WorldCoord,
} from './types'

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message)
}

/** Rotations for 0, 60, 120, 180, 240 and 300 degrees */
export const rotations: Rotation[] = [
	({ q, r }) => ({ q, r }),
	({ q, r }) => ({ q: q + r, r: -q }),
	({ q, r }) => ({ q: r, r: -q - r }),
	({ q, r }) => ({ q: -q, r: -r }),
	({ q, r }) => ({ q: -q - r, r: q }),
	({ q, r }) => ({ q: -r, r: q + r }),
]

export const hexSides = rotations.map((c) => c({ q: 1, r: 0 }))

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

export function axialRectangle(start: AxialRef, end: AxialRef): AxialCoord[] {
	const startCoord = axial.coord(start)
	const endCoord = axial.coord(end)
	const startS = -startCoord.q - startCoord.r
	const endS = -endCoord.q - endCoord.r

	const minQ = Math.min(startCoord.q, endCoord.q)
	const maxQ = Math.max(startCoord.q, endCoord.q)
	const minR = Math.min(startCoord.r, endCoord.r)
	const maxR = Math.max(startCoord.r, endCoord.r)
	const minS = Math.min(startS, endS)
	const maxS = Math.max(startS, endS)

	const coords: AxialCoord[] = []
	for (let q = minQ; q <= maxQ; q++) {
		for (let r = minR; r <= maxR; r++) {
			const s = -q - r
			if (s >= minS && s <= maxS) coords.push({ q, r })
		}
	}
	return coords
}

function bitShiftUnpair(z: number): AxialCoord {
	const rv = { q: z >> 16, r: z & 0xffff }
	if (rv.r > 32767) rv.r -= 65536
	return rv
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

export const axial = {
	access(aRef: AxialRef): Axial {
		if (typeof aRef === 'string') return axial.keyAccess(aRef)
		return axial.coordAccess(aRef)
	},
	keyAccess(aRef: AxialKey): Axial {
		return { key: aRef, ...axial.coord(aRef) }
	},
	coordAccess(aRef: AxialCoord): Axial {
		assert(typeof aRef === 'object', 'aRef must be an object')
		assert(!('key' in aRef) || aRef.key !== undefined, 'key must be defined if set')
		if ('key' in aRef) return aRef as Axial
		return Object.assign(aRef, { key: `${aRef.q},${aRef.r}` })
	},
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
	key(aRef: AxialRef | string): AxialKey {
		switch (typeof aRef) {
			case 'string':
				return aRef
			default:
				return axial.coordAccess(aRef as Axial).key
		}
	},
	toString(aRef: Axial) {
		const { q, r } = axial.access(aRef)
		return `<${q} ${r}>`
	},
	linear(...args: ([number, AxialRef] | AxialRef)[]): AxialCoord {
		return args.reduce<AxialCoord>(
			(acc, term) => {
				const [coef, aRef] = Array.isArray(term) ? term : [1, term]
				const { q, r } = axial.coord(aRef)
				return { q: acc.q + coef * q, r: acc.r + coef * r }
			},
			{ q: 0, r: 0 }
		)
	},
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
	orthogonal(ARef: AxialRef, BRef: AxialRef): [AxialCoord, AxialCoord] {
		const sideAxial = axial.linear(ARef, [-1, BRef])
		const side = hexSides.findIndex(({ q, r }) => q === sideAxial.q && r === sideAxial.r)
		assert(side !== -1, 'Orthogonal: Points must be neighbors')
		return [
			axial.linear(BRef, hexSides[(side + 1) % 6]),
			axial.linear(BRef, hexSides[(side + 5) % 6]),
		]
	},
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
	*allTiles(center: AxialCoord, radius: number): Generator<AxialCoord> {
		for (const offset of axial.enum(radius)) {
			yield axial.linear(center, offset)
		}
	},
	neighbors(aRef: AxialRef): Sextuplet<AxialCoord> {
		return hexSides.map((side) => axial.linear(aRef, side)) as Sextuplet<AxialCoord>
	},
	neighborIndex(coord: AxialCoord, from?: AxialCoord) {
		if (from) coord = axial.linear(coord, [-1, from])
		return neighborIndexes[coord.q * 3 + coord.r + 4]
	},
}
