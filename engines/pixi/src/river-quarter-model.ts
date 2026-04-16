/**
 * Procedural river geometry: quarters (bank lobes), half-drageas (paired quarters),
 * branches, and per-tile composition. Simulation truth stays on hydrology edges;
 * this module is render-planning only.
 */
import type {
	TerrainHydrologyEdgeSample,
	TerrainHydrologySample,
	TerrainRiverFlowSample,
} from 'ssh/game/terrain-provider'
import type { TerrainType } from 'ssh/types'
import type { AxialCoord } from 'ssh/utils'
import { axial, cartesian, hexSides } from 'ssh/utils'

import { classifyRiverBodyAngle } from './river-topology'

const HEX_SIDES = hexSides as unknown as readonly [
	AxialCoord,
	AxialCoord,
	AxialCoord,
	AxialCoord,
	AxialCoord,
	AxialCoord,
]

export interface Vec2 {
	readonly x: number
	readonly y: number
}

export type RiverQuarterSide = 'left' | 'right'

export type RiverQuarterTerminalRole = 'sourceTip' | 'lakeLip' | 'mouthLip' | 'deltaFan'

export type RiverHalfDrageaTerminalCap = 'none' | 'closed' | 'open' | 'fanned'

/** High-level tile terminal / junction role for ordering and tuning. */
export type RiverTerminalSummary =
	| 'none'
	| 'source'
	| 'mouth'
	| 'lake'
	| 'inlandTerminal'
	| 'delta'
	| 'through'
	| 'junction'

export interface RiverQuarter {
	readonly tileKey: string
	readonly edgeDirection: number
	readonly side: RiverQuarterSide
	readonly outerMidpoint: Vec2
	readonly innerAnchor: Vec2
	/** Quadratic Bezier control polyline: start, control, end (world space). */
	readonly bankCurve: readonly [Vec2, Vec2, Vec2]
	readonly widthStart: number
	readonly widthEnd: number
	readonly depthWeight: number
	readonly terminalRole?: RiverQuarterTerminalRole
}

export interface RiverHalfDragea {
	readonly entryDirection: number
	readonly innerAnchor: Vec2
	readonly leftQuarter: RiverQuarter
	readonly rightQuarter: RiverQuarter
	readonly channelWidthProfile: { readonly start: number; readonly end: number }
	readonly terminalCap: RiverHalfDrageaTerminalCap
}

export interface RiverBranch {
	readonly id: string
	/** Branch-local attractor for width shaping and center arbitration (world space). */
	readonly deepCenter: Vec2
	readonly halfDrageas: readonly RiverHalfDragea[]
}

export interface RiverTileNode {
	readonly tileKey: string
	readonly coord: AxialCoord
	readonly activeEdges: readonly number[]
	readonly branches: readonly RiverBranch[]
	/** Tile center and typical arbitration radius around the hub (world space). */
	readonly centerZone: { readonly origin: Vec2; readonly radius: number }
	readonly terminalSummary: RiverTerminalSummary
	readonly suppressed: boolean
}

export interface BuildRiverTileNodeInput {
	readonly tileKey: string
	readonly coord: AxialCoord
	readonly tileSize: number
	readonly terrain: TerrainType | undefined
	readonly hydrologyEdges: Partial<Record<number, TerrainHydrologyEdgeSample>>
	readonly riverFlow?: TerrainRiverFlowSample
	/**
	 * When set (e.g. sector bake), overrides per-tile monotone width with a branch-relaxed value.
	 */
	readonly tileHalfOuterFromBake?: number
	readonly neighborTerrain: (direction: number) => TerrainType | undefined
	/**
	 * When true, skip overlay for this tile (e.g. duplicate water mouth suppressed
	 * upstream in sector baker).
	 */
	readonly suppressed?: boolean
}

function normalize2(x: number, y: number): Vec2 {
	const len = Math.hypot(x, y)
	if (len < 1e-9) return { x: 0, y: 0 }
	return { x: x / len, y: y / len }
}

function add(a: Vec2, b: Vec2): Vec2 {
	return { x: a.x + b.x, y: a.y + b.y }
}

function sub(a: Vec2, b: Vec2): Vec2 {
	return { x: a.x - b.x, y: a.y - b.y }
}

function scale(v: Vec2, s: number): Vec2 {
	return { x: v.x * s, y: v.y * s }
}

function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
	return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function distanceSq(a: Vec2, b: Vec2): number {
	const dx = a.x - b.x
	const dy = a.y - b.y
	return dx * dx + dy * dy
}

function rotate90(v: Vec2): Vec2 {
	return { x: -v.y, y: v.x }
}

function dot(a: Vec2, b: Vec2): number {
	return a.x * b.x + a.y * b.y
}

function crossZ(a: Vec2, b: Vec2): number {
	return a.x * b.y - a.y * b.x
}

/**
 * Unit tangent along the hex edge at `direction`, perpendicular to inward flow.
 * When `pairedDirection` is set, choose the sign so the paired edge midpoint lies on the
 * +tangent side from this edge's midpoint (keeps bends opening toward the channel wedge).
 */
function edgeTangentUnit(
	coord: AxialCoord,
	direction: number,
	tileSize: number,
	pairedDirection: number | undefined
): Vec2 {
	const inward = inwardUnitFromEdge(coord, direction, tileSize)
	const outerMid = edgeWorldMidpoint(coord, direction, tileSize)
	const baseT = rotate90(inward)
	if (pairedDirection === undefined) {
		return normalize2(baseT.x, baseT.y)
	}
	const pairedOuter = edgeWorldMidpoint(coord, pairedDirection, tileSize)
	const towardPaired = sub(pairedOuter, outerMid)
	if (Math.abs(crossZ(towardPaired, inward)) < tileSize * 1e-4) {
		return normalize2(baseT.x, baseT.y)
	}
	const alongT = dot(towardPaired, baseT)
	const chosen = alongT >= 0 ? baseT : scale(baseT, -1)
	return normalize2(chosen.x, chosen.y)
}

function tileWorldCenter(coord: AxialCoord, tileSize: number): Vec2 {
	return cartesian(coord, tileSize)
}

function edgeWorldMidpoint(coord: AxialCoord, direction: number, tileSize: number): Vec2 {
	const index = ((direction % 6) + 6) % 6
	const side = HEX_SIDES[index]
	if (!side) return tileWorldCenter(coord, tileSize)
	return cartesian({ q: coord.q + side.q * 0.5, r: coord.r + side.r * 0.5 }, tileSize)
}

function inwardUnitFromEdge(coord: AxialCoord, direction: number, tileSize: number): Vec2 {
	const center = tileWorldCenter(coord, tileSize)
	const mid = edgeWorldMidpoint(coord, direction, tileSize)
	return normalize2(center.x - mid.x, center.y - mid.y)
}

function strokeHalfWidth(edgeWidth: number, tileSize: number): number {
	const stroke = Math.max(tileSize * 0.16, Math.min(tileSize * 0.46, edgeWidth * 1.9))
	return stroke / 2
}

/** Smoothed downstream-growing half-stroke for visible river width (render planning). */
export function riverMonotoneRenderHalfOuter(
	tileSize: number,
	flow: TerrainRiverFlowSample,
	rawMaxHalfStroke: number
): number {
	const minTip = tileSize * 0.07
	const cap = Math.max(rawMaxHalfStroke, minTip * 1.5)
	const span = Math.max(1, flow.rankFromSource + flow.rankToSea)
	const t = span > 0 ? flow.rankFromSource / span : 1
	const s = t * t * (3 - 2 * t)
	return minTip + (cap - minTip) * s
}

function neighborAtDirection(coord: AxialCoord, direction: number): AxialCoord {
	const index = ((direction % 6) + 6) % 6
	const side = HEX_SIDES[index]
	if (!side) return coord
	return { q: coord.q + side.q, r: coord.r + side.r }
}

/**
 * Relax visible half-widths along `riverFlow.downstreamDirections` so downstream tiles never
 * shrink relative to upstream (within the bake tile set).
 */
export function computeRiverBakeMonotoneHalfOuterMap(
	bakeTileCoords: readonly AxialCoord[],
	tileSize: number,
	terrainTiles: ReadonlyMap<string, { hydrology?: TerrainHydrologySample }>
): Map<string, number> {
	const keySet = new Set(bakeTileCoords.map((c) => axial.key(c)))
	const w = new Map<string, number>()

	const perTileBase = (coord: AxialCoord): number | undefined => {
		const sample = terrainTiles.get(axial.key(coord))
		const hyd = sample?.hydrology
		const rf = hyd?.riverFlow
		const edges = hyd?.edges
		if (!rf || !edges || Object.keys(edges).length === 0) return undefined
		const active = collectActiveDirections(edges)
		if (active.length === 0) return undefined
		const rawMax = maxStrokeHalfWidthForDirections(active, edges, tileSize)
		return riverMonotoneRenderHalfOuter(tileSize, rf, rawMax)
	}

	for (const coord of bakeTileCoords) {
		const b = perTileBase(coord)
		if (b !== undefined) w.set(axial.key(coord), b)
	}

	const maxRelax = Math.max(8, bakeTileCoords.length + 8)
	for (let iter = 0; iter < maxRelax; iter += 1) {
		let changed = false
		for (const coord of bakeTileCoords) {
			const k = axial.key(coord)
			const upW = w.get(k)
			if (upW === undefined) continue
			const rf = terrainTiles.get(k)?.hydrology?.riverFlow
			if (!rf) continue
			for (const dir of rf.downstreamDirections) {
				const dn = dir as number
				const nCoord = neighborAtDirection(coord, dn)
				const nk = axial.key(nCoord)
				if (!keySet.has(nk)) continue
				const childRf = terrainTiles.get(nk)?.hydrology?.riverFlow
				if (!childRf) continue
				const baseChild = perTileBase(nCoord) ?? 0
				const cur = w.get(nk) ?? baseChild
				const nextVal = Math.max(cur, upW)
				if (!w.has(nk)) {
					w.set(nk, nextVal)
					changed = true
				} else if (nextVal > cur + 1e-9) {
					w.set(nk, nextVal)
					changed = true
				}
			}
		}
		if (!changed) break
	}
	return w
}

function maxStrokeHalfWidthForDirections(
	directions: readonly number[],
	edges: Partial<Record<number, TerrainHydrologyEdgeSample>>,
	tileSize: number
): number {
	let m = 0
	for (const d of directions) {
		const e = edges[d]
		if (e) m = Math.max(m, strokeHalfWidth(e.width, tileSize))
	}
	return m
}

function resolveRiverTerminalSummary(args: {
	readonly directions: readonly number[]
	readonly terrain: TerrainType | undefined
	readonly neighborTerrain: (direction: number) => TerrainType | undefined
	readonly maxEdgeWidth: number
	readonly riverFlow: TerrainRiverFlowSample | undefined
}): RiverTerminalSummary {
	const classified = classifyRiverTerminalSummary({
		directions: args.directions,
		terrain: args.terrain,
		neighborTerrain: args.neighborTerrain,
		maxEdgeWidth: args.maxEdgeWidth,
	})
	const flow = args.riverFlow
	if (flow === undefined) return classified
	switch (flow.tileRole) {
		case 'inlandTerminal':
			return 'inlandTerminal'
		case 'source':
			return 'source'
		case 'through':
			return 'through'
		case 'junction':
			return 'junction'
		case 'delta':
			return 'delta'
		case 'mouth':
			return classified === 'lake' || classified === 'mouth' ? classified : 'mouth'
		default:
			return classified
	}
}

function depthWeightForEdge(edge: TerrainHydrologyEdgeSample, maxDepth: number): number {
	if (!(maxDepth > 0)) return 0
	return Math.max(0, Math.min(1, edge.depth / maxDepth))
}

function bendHintForPair(a: number, b: number): 'straight180' | 'bend60' | 'bend120' {
	return classifyRiverBodyAngle([a, b]) ?? 'straight180'
}

function bulgeVectorForPair(
	coord: AxialCoord,
	a: number,
	b: number,
	tileSize: number,
	bend: 'straight180' | 'bend60' | 'bend120',
	hub: Vec2,
	outerMid: Vec2
): Vec2 {
	const ia = inwardUnitFromEdge(coord, a, tileSize)
	const ib = inwardUnitFromEdge(coord, b, tileSize)
	const bis = normalize2(ia.x + ib.x, ia.y + ib.y)
	if (bend === 'straight180') return { x: 0, y: 0 }
	const mag = bend === 'bend60' ? 0.12 * tileSize : 0.18 * tileSize
	let out = scale(bis, mag)
	const hubDelta = sub(hub, outerMid)
	const toHub = normalize2(hubDelta.x, hubDelta.y)
	if (dot(out, toHub) < 0) {
		out = scale(out, -1)
	}
	return out
}

function collectActiveDirections(
	edges: Partial<Record<number, TerrainHydrologyEdgeSample>>
): number[] {
	return Object.keys(edges)
		.map(Number)
		.filter(
			(d) => Number.isInteger(d) && d >= 0 && d <= 5 && edges[d] !== undefined && edges[d] !== null
		)
		.sort((a, b) => a - b)
}

function waterEdgeDirections(
	directions: readonly number[],
	neighborTerrain: (direction: number) => TerrainType | undefined
): number[] {
	return directions.filter((d) => neighborTerrain(d) === 'water')
}

function maxEdgeWidthForDirections(
	directions: readonly number[],
	edges: Partial<Record<number, TerrainHydrologyEdgeSample>>
): number {
	let maxW = 0
	for (const d of directions) {
		const e = edges[d]
		if (e) maxW = Math.max(maxW, e.width)
	}
	return maxW
}

function maxDepthForDirections(
	directions: readonly number[],
	edges: Partial<Record<number, TerrainHydrologyEdgeSample>>
): number {
	let maxD = 0
	for (const d of directions) {
		const e = edges[d]
		if (e) maxD = Math.max(maxD, e.depth)
	}
	return maxD
}

/**
 * Classify terminal / hub summary. Order of checks matches rollout: source, mouth,
 * lake, delta, then through vs junction.
 */
export function classifyRiverTerminalSummary(args: {
	readonly directions: readonly number[]
	readonly terrain: TerrainType | undefined
	readonly neighborTerrain: (direction: number) => TerrainType | undefined
	readonly maxEdgeWidth: number
}): RiverTerminalSummary {
	const { directions, terrain, neighborTerrain, maxEdgeWidth } = args
	if (directions.length === 0) return 'none'
	if (terrain === 'water') return 'none'

	const waterDirs = waterEdgeDirections(directions, neighborTerrain)

	if (directions.length === 1) {
		const d = directions[0]!
		if (neighborTerrain(d) === 'water') {
			if (maxEdgeWidth >= 4.25) return 'mouth'
			return 'lake'
		}
		return 'source'
	}

	if (directions.length >= 3) {
		if (waterDirs.length >= 2 && maxEdgeWidth >= 4.25) return 'delta'
		if (directions.length >= 4 && waterDirs.length >= 2) return 'delta'
		return 'junction'
	}

	if (directions.length === 2) {
		if (waterDirs.length === 1) return 'mouth'
		return 'through'
	}

	return 'junction'
}

/**
 * Center-zone arbitration: pick the branch whose `deepCenter` is closest to `worldPoint`.
 * Used for junctions and multi-arm tiles; single-branch tiles always return `0`.
 */
export function riverBranchOwnershipIndexAtWorld(
	node: RiverTileNode,
	worldPoint: Vec2
): number | undefined {
	if (node.branches.length === 0) return undefined
	if (node.branches.length === 1) return 0
	let bestIndex = 0
	let bestDist = Number.POSITIVE_INFINITY
	for (let i = 0; i < node.branches.length; i += 1) {
		const d = distanceSq(worldPoint, node.branches[i]!.deepCenter)
		if (d < bestDist) {
			bestDist = d
			bestIndex = i
		}
	}
	return bestIndex
}

/**
 * True when `worldPoint` lies inside the tile's arbitration disk (hub region).
 */
export function isInsideRiverCenterZone(node: RiverTileNode, worldPoint: Vec2): boolean {
	return (
		distanceSq(worldPoint, node.centerZone.origin) <=
		node.centerZone.radius * node.centerZone.radius
	)
}

function buildQuarter(args: {
	tileKey: string
	direction: number
	side: RiverQuarterSide
	outerMid: Vec2
	inner: Vec2
	halfWOuter: number
	halfWInner: number
	inward: Vec2
	tangent: Vec2
	bulge: Vec2
	edge: TerrainHydrologyEdgeSample
	maxDepth: number
	terminalRole?: RiverQuarterTerminalRole
}): RiverQuarter {
	const sign = args.side === 'left' ? 1 : -1
	const p0 = add(args.outerMid, scale(args.tangent, sign * args.halfWOuter))
	const p2 = add(args.inner, scale(args.tangent, sign * args.halfWInner))
	const mid = lerp2(p0, p2, 0.5)
	const p1 = add(
		add(mid, args.bulge),
		scale(args.inward, 0.06 * (args.halfWOuter + args.halfWInner))
	)
	return {
		tileKey: args.tileKey,
		edgeDirection: args.direction,
		side: args.side,
		outerMidpoint: args.outerMid,
		innerAnchor: args.inner,
		bankCurve: [p0, p1, p2],
		widthStart: args.halfWOuter * 2,
		widthEnd: args.halfWInner * 2,
		depthWeight: depthWeightForEdge(args.edge, args.maxDepth),
		terminalRole: args.terminalRole,
	}
}

function buildHalfDragea(args: {
	tileKey: string
	coord: AxialCoord
	tileSize: number
	direction: number
	edge: TerrainHydrologyEdgeSample
	deepCenter: Vec2
	/** Shared tile hub (typically geometric tile center); quarters meet here for continuity. */
	hub: Vec2
	terminalCap: RiverHalfDrageaTerminalCap
	pairedDirection?: number
	terminalRole?: RiverQuarterTerminalRole
	maxDepth: number
	tileHalfOuter?: number
	/**
	 * When set (through tiles with two land edges), inner bank width at the hub follows this value
	 * so width evolves W1 → (W1+W2)/2 → W2 across the tile instead of jumping at the center.
	 */
	halfWInnerOverride?: number
}): RiverHalfDragea {
	const { coord, tileSize, direction, edge, terminalCap, pairedDirection, hub } = args
	const outerMid = edgeWorldMidpoint(coord, direction, tileSize)
	const inward = inwardUnitFromEdge(coord, direction, tileSize)
	const inner = hub
	const tangent = edgeTangentUnit(coord, direction, tileSize, pairedDirection)

	const bend =
		pairedDirection === undefined ? 'straight180' : bendHintForPair(direction, pairedDirection)
	const bulge =
		pairedDirection === undefined
			? { x: 0, y: 0 }
			: bulgeVectorForPair(coord, direction, pairedDirection, tileSize, bend, hub, outerMid)

	const halfWOuter = args.tileHalfOuter ?? strokeHalfWidth(edge.width, tileSize)
	/** Through (`none`) caps keep inner width near outer so adjacent tiles do not read wide-thin-wide. */
	const throughInnerScale = 0.92
	/** Source tip: slightly wider than a needle so springs read on the map. */
	const sourceClosedInnerScale = 0.12
	let halfWInner: number
	if (args.halfWInnerOverride !== undefined) {
		halfWInner = args.halfWInnerOverride
	} else {
		halfWInner =
			halfWOuter *
			(terminalCap === 'closed'
				? sourceClosedInnerScale
				: terminalCap === 'open'
					? 0.72
					: throughInnerScale)
	}

	if (terminalCap === 'fanned' && args.halfWInnerOverride === undefined) {
		halfWInner = halfWOuter * 0.88
	}

	const left = buildQuarter({
		tileKey: args.tileKey,
		direction,
		side: 'left',
		outerMid,
		inner,
		halfWOuter,
		halfWInner,
		inward,
		tangent,
		bulge,
		edge,
		maxDepth: args.maxDepth,
		terminalRole: args.terminalRole,
	})
	const right = buildQuarter({
		tileKey: args.tileKey,
		direction,
		side: 'right',
		outerMid,
		inner,
		halfWOuter,
		halfWInner,
		inward,
		tangent,
		bulge,
		edge,
		maxDepth: args.maxDepth,
		terminalRole: args.terminalRole,
	})

	return {
		entryDirection: direction,
		innerAnchor: inner,
		leftQuarter: left,
		rightQuarter: right,
		channelWidthProfile: { start: halfWOuter * 2, end: halfWInner * 2 },
		terminalCap,
	}
}

function armDeepCenter(coord: AxialCoord, tileSize: number, direction: number): Vec2 {
	const center = tileWorldCenter(coord, tileSize)
	const inward = inwardUnitFromEdge(coord, direction, tileSize)
	return add(center, scale(inward, 0.11 * tileSize))
}

function throughDeepCenter(coord: AxialCoord, tileSize: number, a: number, b: number): Vec2 {
	const center = tileWorldCenter(coord, tileSize)
	const ia = inwardUnitFromEdge(coord, a, tileSize)
	const ib = inwardUnitFromEdge(coord, b, tileSize)
	const sum = normalize2(ia.x + ib.x, ia.y + ib.y)
	return add(center, scale(sum, 0.06 * tileSize))
}

export function buildRiverTileNode(input: BuildRiverTileNodeInput): RiverTileNode {
	const {
		tileKey,
		coord,
		tileSize,
		terrain,
		hydrologyEdges,
		riverFlow,
		tileHalfOuterFromBake,
		neighborTerrain,
		suppressed = false,
	} = input

	const activeEdges = collectActiveDirections(hydrologyEdges)
	const center = tileWorldCenter(coord, tileSize)
	const centerZone = { origin: center, radius: 0.28 * tileSize }

	if (suppressed || terrain === 'water' || activeEdges.length === 0) {
		return {
			tileKey,
			coord,
			activeEdges,
			branches: [],
			centerZone,
			terminalSummary: 'none',
			suppressed: suppressed || terrain === 'water',
		}
	}

	const maxW = maxEdgeWidthForDirections(activeEdges, hydrologyEdges)
	const maxDepth = maxDepthForDirections(activeEdges, hydrologyEdges)
	const waterDirs = waterEdgeDirections(activeEdges, neighborTerrain)
	const rawHalfMax = maxStrokeHalfWidthForDirections(activeEdges, hydrologyEdges, tileSize)
	const tileHalfOuter =
		tileHalfOuterFromBake !== undefined
			? tileHalfOuterFromBake
			: riverFlow === undefined
				? undefined
				: riverMonotoneRenderHalfOuter(tileSize, riverFlow, rawHalfMax)
	const summary = resolveRiverTerminalSummary({
		directions: activeEdges,
		terrain,
		neighborTerrain,
		maxEdgeWidth: maxW,
		riverFlow,
	})

	if (activeEdges.length === 2 && waterDirs.length === 1) {
		const waterDirection = waterDirs[0]!
		const landDirection = activeEdges.find((d) => d !== waterDirection)!
		const landEdge = hydrologyEdges[landDirection]!
		const waterEdge = hydrologyEdges[waterDirection]!
		const deepCenter = throughDeepCenter(coord, tileSize, landDirection, waterDirection)
		const rawLand = strokeHalfWidth(landEdge.width, tileSize)
		const rawWater = strokeHalfWidth(waterEdge.width, tileSize)
		const maxCoastal = Math.max(rawLand, rawWater, 1e-9)
		const coastalScale = tileHalfOuter !== undefined ? tileHalfOuter / maxCoastal : 1
		const outerLand = rawLand * coastalScale
		const outerWater = rawWater * coastalScale
		const hubCoastal = ((rawLand + rawWater) / 2) * coastalScale * 0.94
		const waterInnerTowardSea = Math.min(hubCoastal * 0.72, outerWater * 0.55)
		const landHalf = buildHalfDragea({
			tileKey,
			coord,
			tileSize,
			direction: landDirection,
			edge: landEdge,
			deepCenter,
			hub: center,
			terminalCap: 'none',
			pairedDirection: waterDirection,
			maxDepth,
			tileHalfOuter: outerLand,
			halfWInnerOverride: hubCoastal,
		})
		const waterHalf = buildHalfDragea({
			tileKey,
			coord,
			tileSize,
			direction: waterDirection,
			edge: waterEdge,
			deepCenter,
			hub: center,
			terminalCap: 'open',
			pairedDirection: landDirection,
			terminalRole: 'mouthLip',
			maxDepth,
			tileHalfOuter: outerWater,
			halfWInnerOverride: waterInnerTowardSea,
		})
		return {
			tileKey,
			coord,
			activeEdges,
			branches: [
				{
					id: 'coastal-mouth',
					deepCenter,
					halfDrageas: [landHalf, waterHalf],
				},
			],
			centerZone,
			terminalSummary: summary === 'lake' ? 'lake' : 'mouth',
			suppressed: false,
		}
	}

	if (activeEdges.length === 1) {
		const d = activeEdges[0]!
		const edge = hydrologyEdges[d]!
		const n = neighborTerrain(d)
		const deepCenter = add(center, scale(inwardUnitFromEdge(coord, d, tileSize), 0.09 * tileSize))
		if (n === 'water') {
			const cap: RiverHalfDrageaTerminalCap = 'open'
			const role: RiverQuarterTerminalRole = summary === 'lake' ? 'lakeLip' : 'mouthLip'
			const half = buildHalfDragea({
				tileKey,
				coord,
				tileSize,
				direction: d,
				edge,
				deepCenter,
				hub: center,
				terminalCap: cap,
				terminalRole: role,
				maxDepth,
				tileHalfOuter,
			})
			return {
				tileKey,
				coord,
				activeEdges,
				branches: [{ id: 'terminal-water', deepCenter, halfDrageas: [half] }],
				centerZone,
				terminalSummary: summary === 'lake' ? 'lake' : 'mouth',
				suppressed: false,
			}
		}
		if (summary === 'inlandTerminal') {
			const half = buildHalfDragea({
				tileKey,
				coord,
				tileSize,
				direction: d,
				edge,
				deepCenter,
				hub: center,
				terminalCap: 'open',
				terminalRole: 'lakeLip',
				maxDepth,
				tileHalfOuter,
			})
			return {
				tileKey,
				coord,
				activeEdges,
				branches: [{ id: 'inland-terminal', deepCenter, halfDrageas: [half] }],
				centerZone,
				terminalSummary: 'inlandTerminal',
				suppressed: false,
			}
		}
		const half = buildHalfDragea({
			tileKey,
			coord,
			tileSize,
			direction: d,
			edge,
			deepCenter,
			hub: center,
			terminalCap: 'closed',
			terminalRole: 'sourceTip',
			maxDepth,
			tileHalfOuter,
		})
		return {
			tileKey,
			coord,
			activeEdges,
			branches: [{ id: 'source', deepCenter, halfDrageas: [half] }],
			centerZone,
			terminalSummary: 'source',
			suppressed: false,
		}
	}

	if (activeEdges.length === 2) {
		const [a, b] = activeEdges as [number, number]
		const edgeA = hydrologyEdges[a]!
		const edgeB = hydrologyEdges[b]!
		const deepCenter = throughDeepCenter(coord, tileSize, a, b)
		const rawHalfA = strokeHalfWidth(edgeA.width, tileSize)
		const rawHalfB = strokeHalfWidth(edgeB.width, tileSize)
		const maxRaw = Math.max(rawHalfA, rawHalfB, 1e-9)
		const monoScale = tileHalfOuter !== undefined ? tileHalfOuter / maxRaw : 1
		const outerA = rawHalfA * monoScale
		const outerB = rawHalfB * monoScale
		const hubHalf = ((rawHalfA + rawHalfB) / 2) * monoScale * 0.98
		const halfA = buildHalfDragea({
			tileKey,
			coord,
			tileSize,
			direction: a,
			edge: edgeA,
			deepCenter,
			hub: center,
			terminalCap: 'none',
			pairedDirection: b,
			maxDepth,
			tileHalfOuter: outerA,
			halfWInnerOverride: hubHalf,
		})
		const halfB = buildHalfDragea({
			tileKey,
			coord,
			tileSize,
			direction: b,
			edge: edgeB,
			deepCenter,
			hub: center,
			terminalCap: 'none',
			pairedDirection: a,
			maxDepth,
			tileHalfOuter: outerB,
			halfWInnerOverride: hubHalf,
		})
		return {
			tileKey,
			coord,
			activeEdges,
			branches: [{ id: 'through', deepCenter, halfDrageas: [halfA, halfB] }],
			centerZone,
			terminalSummary: 'through',
			suppressed: false,
		}
	}

	const branches: RiverBranch[] = []
	for (const d of activeEdges) {
		const edge = hydrologyEdges[d]!
		const deep = armDeepCenter(coord, tileSize, d)
		const isWaterArm = waterDirs.includes(d)
		const cap: RiverHalfDrageaTerminalCap = isWaterArm
			? summary === 'delta'
				? 'fanned'
				: 'open'
			: 'none'
		const role: RiverQuarterTerminalRole | undefined = isWaterArm
			? summary === 'delta'
				? 'deltaFan'
				: 'mouthLip'
			: undefined
		branches.push({
			id: `arm-${d}`,
			deepCenter: deep,
			halfDrageas: [
				buildHalfDragea({
					tileKey,
					coord,
					tileSize,
					direction: d,
					edge,
					deepCenter: deep,
					hub: center,
					terminalCap: cap,
					terminalRole: role,
					maxDepth,
					tileHalfOuter,
				}),
			],
		})
	}

	return {
		tileKey,
		coord,
		activeEdges,
		branches,
		centerZone,
		terminalSummary: summary === 'delta' ? 'delta' : 'junction',
		suppressed: false,
	}
}

/** Sample a quadratic Bezier at t in [0,1]. */
export function sampleQuadraticBezier(a: Vec2, b: Vec2, c: Vec2, t: number): Vec2 {
	const u = 1 - t
	return {
		x: u * u * a.x + 2 * u * t * b.x + t * t * c.x,
		y: u * u * a.y + 2 * u * t * b.y + t * t * c.y,
	}
}

/** Flattened polygon for one half-dragea water wedge (world space), CCW. */
export function halfDrageaWaterPolygonWorld(h: RiverHalfDragea): Vec2[] {
	const { leftQuarter: L, rightQuarter: R } = h
	const lo = L.bankCurve[0]!
	const ro = R.bankCurve[0]!
	const li = L.bankCurve[2]!
	const ri = R.bankCurve[2]!
	return [lo, ro, ri, li]
}

const DEFAULT_HALF_DRAGEA_FILL_STEPS = 6

/**
 * Water fill contour that follows the same quadratic bank curves as the stroke (world space, CCW).
 * Avoids straight-chord fills that diverge from curved banks on bends.
 */
export function halfDrageaSampledFillPolygonWorld(
	h: RiverHalfDragea,
	steps: number = DEFAULT_HALF_DRAGEA_FILL_STEPS
): Vec2[] {
	const { leftQuarter: L, rightQuarter: R } = h
	const [L0, L1, L2] = L.bankCurve
	const [R0, R1, R2] = R.bankCurve
	const n = Math.max(2, Math.floor(steps))
	const out: Vec2[] = []
	for (let i = 0; i <= n; i += 1) {
		out.push(sampleQuadraticBezier(L0, L1, L2, i / n))
	}
	// Include t=1 on the right bank so the loop closes along the inner lip (omit caused a hub “cut”).
	for (let i = n; i >= 0; i -= 1) {
		out.push(sampleQuadraticBezier(R0, R1, R2, i / n))
	}
	return out
}

export function tileKeyForCoord(coord: AxialCoord): string {
	return axial.key(coord)
}
