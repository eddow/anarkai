/**
 * @link https://www.redblobgames.com/grids/hexagons/
 *
 * Core hex math lives in engine-terrain/hex.
 * This file re-exports everything and adds ssh-specific helpers.
 */

export type {
	Axial,
	AxialCoord,
	AxialDirection,
	AxialKey,
	AxialRef,
	Rotation,
	Sextuplet,
	WorldCoord,
} from 'engine-terrain/hex'
export {
	axialRectangle,
	cartesian,
	fromCartesian,
	hexSides,
	hexTiles,
	rotations,
} from 'engine-terrain/hex'

import {
	type AxialRef,
	axial as coreAxial,
	fromCartesian,
	type WorldCoord,
} from 'engine-terrain/hex'
import type { RandGenerator } from './numbers'

// ─── SSH-specific types ──────────────────────────────────────────

/**
 * Position in a triangle: side of the triangle and [u,v] where u+v<=1
 */
export interface Triangular {
	/** Side: [0..6[ */
	s: number
	u: number
	v: number
}

// ─── SSH-specific functions ──────────────────────────────────────

/**
 * Generate uniformly a valid {s,u,v} position in a tile
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

/**
 * Test if a world point is inside a hexagonal tile
 */
export function pointInHex(point: WorldCoord, coord: AxialRef, size: number): boolean {
	const pointAxial = fromCartesian(point, size)
	const { q, r } = axial.access(coord)
	return axial.distance(pointAxial, { q, r }) <= 0.5
}

function randomPositionInTile(gen: RandGenerator, size: number = 1) {
	const { s, u, v } = genTilePosition(gen, size / 2)
	const angle = Math.PI / 3
	return {
		x: Math.cos(s * angle) * u + Math.cos((s + 1) * angle) * v,
		y: Math.sin(s * angle) * u + Math.sin((s + 1) * angle) * v,
	}
}

// ─── Extended axial namespace ────────────────────────────────────

export const axial: typeof coreAxial & {
	randomPositionInTile: typeof randomPositionInTile
} = Object.assign(coreAxial, { randomPositionInTile })

//@ts-expect-error - this is only for debug purpose anyway
if (typeof window !== 'undefined') window.axial = axial
