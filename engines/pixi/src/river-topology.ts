import { type AxialCoord, cartesian, hexSides } from 'ssh/utils'

const HEX_SIDES = hexSides as unknown as readonly [
	AxialCoord,
	AxialCoord,
	AxialCoord,
	AxialCoord,
	AxialCoord,
	AxialCoord,
]

/** Width of the inscribed hex in river body SVG art (flat-top clip polygon span). */
const RIVER_ART_HEX_WIDTH = 464 - 48
const RIVER_ART_HEX_HEIGHT = 436.1 - 75.9

/**
 * Approximate span (px) of the straight water stroke along the texture Y axis in the
 * 512² straight body SVGs (`M … 55.9 L … 456.1`). Used so scale is driven by painted
 * reach, not only the outer hex clip (otherwise neighbours barely meet).
 */
const RIVER_STRAIGHT_WATER_SPAN_PX = 456.1 - 55.9

export type RiverBodyAngle = 'straight180' | 'bend60' | 'bend120'

export type RiverJunctionKind =
	| 'junction_y_120'
	| 'junction_arc_stub'
	| 'junction_skew'
	| 'junction_4a'
	| 'junction_4b'
	| 'junction_4c'
	| 'junction_5way'
	| 'junction_6hub'

export type RiverTerminalKind = 'source' | 'pool' | 'mouth' | 'delta'

export type RiverWidthBand = 'narrow' | 'medium' | 'wide'

export type RiverTileRenderPlan =
	| { mode: 'none' }
	| { mode: 'debug' }
	| {
			mode: 'sprite'
			spriteKind: 'body'
			angle: RiverBodyAngle
			widthBand: RiverWidthBand
			textureKey: string
			rotation: number
			scale: number
	  }
	| {
			mode: 'sprite'
			spriteKind: 'junction'
			junction: RiverJunctionKind
			widthBand: RiverWidthBand
			textureKey: string
			rotation: number
			scale: number
	  }
	| {
			mode: 'sprite'
			spriteKind: 'terminal'
			terminal: RiverTerminalKind
			direction: number
			widthBand: RiverWidthBand
			textureKey: string
			rotation: number
			scale: number
	  }

function normalize2(x: number, y: number): { x: number; y: number } {
	const len = Math.hypot(x, y)
	if (len < 1e-9) return { x: 0, y: 0 }
	return { x: x / len, y: y / len }
}

function edgeMidpointVector(direction: number, tileSize: number): { x: number; y: number } {
	const index = ((direction % 6) + 6) % 6
	const side = HEX_SIDES[index]
	if (!side) return { x: 0, y: 0 }
	return cartesian({ q: side.q * 0.5, r: side.r * 0.5 }, tileSize)
}

export function riverWidthBandFromEdgeWidth(maxWidth: number): RiverWidthBand {
	if (!Number.isFinite(maxWidth)) return 'medium'
	if (maxWidth <= 2.25) return 'narrow'
	if (maxWidth >= 4.25) return 'wide'
	return 'medium'
}

export function classifyRiverBodyAngle(
	edgeDirections: readonly number[]
): RiverBodyAngle | undefined {
	const uniq = [...new Set(edgeDirections)]
		.filter((d) => Number.isInteger(d) && d >= 0 && d <= 5)
		.sort((a, b) => a - b)
	if (uniq.length !== 2) return undefined
	const a = uniq[0]!
	const b = uniq[1]!
	const diff = (b - a + 6) % 6
	if (diff === 3) return 'straight180'
	if (diff === 1 || diff === 5) return 'bend60'
	if (diff === 2 || diff === 4) return 'bend120'
	return undefined
}

export function riverBodyTextureKey(angle: RiverBodyAngle, band: RiverWidthBand): string {
	switch (angle) {
		case 'straight180':
			return `rivers.body_straight_180__${band}`
		case 'bend60':
			return `rivers.body_bend_60__${band}`
		case 'bend120':
			return `rivers.body_bend_120__${band}`
	}
}

export function riverTerminalTextureKey(kind: RiverTerminalKind, band: RiverWidthBand): string {
	return `rivers.terminal_${kind}__${band}`
}

export function riverJunctionTextureKey(kind: RiverJunctionKind, band: RiverWidthBand): string {
	return `rivers.${kind}__${band}`
}

function normalizedSortedDirections(edgeDirections: readonly number[]): number[] {
	return [...new Set(edgeDirections)]
		.filter((d) => Number.isInteger(d) && d >= 0 && d <= 5)
		.sort((a, b) => a - b)
}

function cyclicGaps(dirs: readonly number[]): number[] {
	if (dirs.length === 0) return []
	const gaps: number[] = []
	for (let index = 0; index < dirs.length; index += 1) {
		const current = dirs[index]!
		const next = dirs[(index + 1) % dirs.length]!
		gaps.push((next - current + 6) % 6 || 6)
	}
	return gaps
}

function gapKeyForDirections(edgeDirections: readonly number[]): string {
	const dirs = normalizedSortedDirections(edgeDirections)
	const gaps = cyclicGaps(dirs)
	if (gaps.length === 0) return ''
	const variants = gaps.map((_, index) => gaps.slice(index).concat(gaps.slice(0, index)).join(','))
	return variants.sort()[0]!
}

function rotateDirections(edgeDirections: readonly number[], shift: number): number[] {
	return edgeDirections.map((direction) => (direction + shift + 6) % 6).sort((a, b) => a - b)
}

function rotationStepsForCanonical(
	edgeDirections: readonly number[],
	canonicalDirections: readonly number[]
): number | undefined {
	const target = normalizedSortedDirections(edgeDirections).join(',')
	for (let shift = 0; shift < 6; shift += 1) {
		if (rotateDirections(canonicalDirections, shift).join(',') === target) {
			return shift
		}
	}
	return undefined
}

export function classifyRiverJunction(
	edgeDirections: readonly number[]
): RiverJunctionKind | undefined {
	switch (gapKeyForDirections(edgeDirections)) {
		case '1,1,4':
			return 'junction_arc_stub'
		case '1,2,3':
			return 'junction_skew'
		case '2,2,2':
			return 'junction_y_120'
		case '1,1,1,3':
			return 'junction_4a'
		case '1,1,2,2':
			return 'junction_4c'
		case '1,2,1,2':
			return 'junction_4b'
		case '1,1,1,1,2':
			return 'junction_5way'
		case '1,1,1,1,1,1':
			return 'junction_6hub'
		default:
			return undefined
	}
}

const JUNCTION_CANONICAL_DIRECTIONS: Record<RiverJunctionKind, readonly number[]> = {
	junction_arc_stub: [0, 1, 2],
	junction_skew: [0, 1, 3],
	junction_y_120: [0, 2, 4],
	junction_4a: [0, 1, 2, 3],
	junction_4b: [0, 1, 3, 4],
	junction_4c: [0, 1, 2, 4],
	junction_5way: [0, 1, 2, 3, 4],
	junction_6hub: [0, 1, 2, 3, 4, 5],
}

export function riverSpriteRotationForJunction(
	kind: RiverJunctionKind,
	edgeDirections: readonly number[]
): number {
	const steps = rotationStepsForCanonical(edgeDirections, JUNCTION_CANONICAL_DIRECTIONS[kind]) ?? 0
	return (steps * Math.PI) / 3
}

/**
 * Rotation (radians, Pixi clockwise) so the authored river body art aligns with the
 * two active hex edge directions. Calibrated against 512×512 SVGs clipped to the hex.
 */
export function riverSpriteRotationForBody(
	angle: RiverBodyAngle,
	edgeA: number,
	edgeB: number,
	tileSize: number
): number {
	const ua = edgeMidpointVector(edgeA, tileSize)
	const ub = edgeMidpointVector(edgeB, tileSize)
	const u0 = normalize2(ua.x, ua.y)
	const u1 = normalize2(ub.x, ub.y)

	if (angle === 'straight180') {
		// Align texture +Y with the axis joining the two edge midpoints (stable vs picking u0 only).
		const w = normalize2(ub.x - ua.x, ub.y - ua.y)
		return Math.atan2(w.x, w.y)
	}

	const bis = normalize2(u0.x + u1.x, u0.y + u1.y)
	// Body art enters from the top of the 512² view (+texture Y). Calibrate offsets per pair [0,1] / [0,2].
	if (angle === 'bend60') {
		return Math.atan2(bis.x, bis.y) - Math.PI / 6
	}
	return Math.atan2(bis.x, bis.y) - Math.PI / 3
}

export function riverSpriteRotationForTerminal(
	kind: RiverTerminalKind,
	direction: number,
	tileSize: number,
	terrain?: string
): number {
	const edge = edgeMidpointVector(direction, tileSize)
	const inward = normalize2(-edge.x, -edge.y)
	const base = Math.atan2(inward.x, inward.y)
	// Source art needs a 180° flip relative to the connected edge so its tapered origin
	// points away from the flow.
	if (kind === 'source') {
		return base + Math.PI
	}
	// Mouth / delta art is authored with the open water side on the texture top edge.
	// Land tiles need the opening on the water edge (opposite the inland-facing base),
	// while water tiles already see that open side on the correct edge.
	if (terrain !== 'water' && (kind === 'mouth' || kind === 'delta')) {
		return base + Math.PI
	}
	return base
}

/** Hex clip → world hex fit (no seam slack). */
export function riverSpriteUniformScale(tileSize: number): number {
	const worldHexWidth = Math.sqrt(3) * tileSize
	const worldHexHeight = 2 * tileSize
	return Math.min(worldHexWidth / RIVER_ART_HEX_WIDTH, worldHexHeight / RIVER_ART_HEX_HEIGHT)
}

/**
 * Final uniform scale for a river body sprite: never smaller than the hex clip fit, but
 * for straights at least large enough that the painted span covers opposite edge midpoints
 * with overlap; bends get a modest boost so arcs meet straights more reliably.
 */
export function riverSpriteScaleForBody(
	tileSize: number,
	angle: RiverBodyAngle,
	edgeA: number,
	edgeB: number
): number {
	const base = riverSpriteUniformScale(tileSize)
	const ua = edgeMidpointVector(edgeA, tileSize)
	const ub = edgeMidpointVector(edgeB, tileSize)
	const chord = Math.hypot(ub.x - ua.x, ub.y - ua.y)

	if (angle === 'straight180') {
		const seam = 1.16
		const fromPaintedSpan = (chord * seam) / RIVER_STRAIGHT_WATER_SPAN_PX
		return Math.max(base * 1.02, fromPaintedSpan)
	}

	if (angle === 'bend60') {
		return base * 1.18
	}
	return base * 1.2
}

export function riverSpriteScaleForTerminal(tileSize: number, kind: RiverTerminalKind): number {
	const base = riverSpriteUniformScale(tileSize)
	switch (kind) {
		case 'source':
			return base * 1.08
		case 'pool':
			return base * 1.12
		case 'mouth':
			return base * 1.12
		case 'delta':
			return base * 1.16
	}
}

function selectRiverTerminalKind(
	terrain: string | undefined,
	widthBand: RiverWidthBand,
	terminalNeighborTerrain: string | undefined
): RiverTerminalKind {
	if (terrain === 'water' || terminalNeighborTerrain === 'water') {
		return widthBand === 'wide' ? 'delta' : 'mouth'
	}
	return 'source'
}

export function planRiverTileOverlay(args: {
	edgeDirections: readonly number[]
	maxEdgeWidth: number
	tileSize: number
	terrain: string | undefined
	terminalNeighborTerrain?: string
	waterEdgeDirections?: readonly number[]
}): RiverTileRenderPlan {
	const dirs = [...new Set(args.edgeDirections)].filter(
		(d) => Number.isInteger(d) && d >= 0 && d <= 5
	)
	if (dirs.length === 0) return { mode: 'none' }

	const widthBand = riverWidthBandFromEdgeWidth(args.maxEdgeWidth)
	const waterEdgeDirections = [...new Set(args.waterEdgeDirections ?? [])].filter(
		(d) => Number.isInteger(d) && d >= 0 && d <= 5
	)

	if (dirs.length === 1) {
		const direction = dirs[0]!
		const terminal = selectRiverTerminalKind(args.terrain, widthBand, args.terminalNeighborTerrain)
		return {
			mode: 'sprite',
			spriteKind: 'terminal',
			terminal,
			direction,
			widthBand,
			textureKey: riverTerminalTextureKey(terminal, widthBand),
			rotation: riverSpriteRotationForTerminal(terminal, direction, args.tileSize, args.terrain),
			scale: riverSpriteScaleForTerminal(args.tileSize, terminal),
		}
	}

	if (dirs.length === 2 && args.terrain !== 'water' && waterEdgeDirections.length === 1) {
		const direction = waterEdgeDirections[0]!
		const terminal = selectRiverTerminalKind('water', widthBand, 'water')
		return {
			mode: 'sprite',
			spriteKind: 'terminal',
			terminal,
			direction,
			widthBand,
			textureKey: riverTerminalTextureKey(terminal, widthBand),
			rotation: riverSpriteRotationForTerminal(terminal, direction, args.tileSize, args.terrain),
			scale: riverSpriteScaleForTerminal(args.tileSize, terminal),
		}
	}

	if (args.terrain === 'water') return { mode: 'none' }

	const junction = classifyRiverJunction(dirs)
	if (junction) {
		return {
			mode: 'sprite',
			spriteKind: 'junction',
			junction,
			widthBand,
			textureKey: riverJunctionTextureKey(junction, widthBand),
			rotation: riverSpriteRotationForJunction(junction, dirs),
			scale: riverSpriteUniformScale(args.tileSize),
		}
	}

	const angle = classifyRiverBodyAngle(dirs)
	if (!angle) return { mode: 'debug' }

	const [a, b] = [...dirs].sort((x, y) => x - y) as [number, number]
	const rotation = riverSpriteRotationForBody(angle, a, b, args.tileSize)
	const scale = riverSpriteScaleForBody(args.tileSize, angle, a, b)
	return {
		mode: 'sprite',
		spriteKind: 'body',
		angle,
		widthBand,
		textureKey: riverBodyTextureKey(angle, widthBand),
		rotation,
		scale,
	}
}
