import { defaultHydrologyTraceConstants } from 'engine-rules'
import { edgeKey } from '../edge-key'
import { axial, hexSides } from '../hex/axial'
import type { AxialCoord, AxialKey } from '../hex/types'
import type {
	EdgeField,
	EdgeKey,
	HydrologyPathTerminalKind,
	TerrainConfig,
	TileField,
	TileRiverFlow,
} from '../types'
import { isSpring } from './springs'

const t = defaultHydrologyTraceConstants
const MIN_TERMINAL_PATH_LENGTH = t.minTerminalPathLength

export interface HydrologyResult {
	edges: Map<EdgeKey, EdgeField>
	banks: Map<AxialKey, number>
	channels: Set<AxialKey>
	channelInfluence: Map<AxialKey, number>
	/** Per-tile river path directions; omitted when no river paths were traced. */
	riverFlow?: Map<AxialKey, TileRiverFlow>
}

interface TileRiverFlowBuilder {
	upstream: Set<number>
	downstream: Set<number>
	rankFromSource: number
	rankToSea: number
	pathTerminalKind?: HydrologyPathTerminalKind
}

function directionFromTileToNeighbor(fromCoord: AxialCoord, toKey: AxialKey): number | undefined {
	const to = axial.coord(toKey)
	const dq = to.q - fromCoord.q
	const dr = to.r - fromCoord.r
	const idx = hexSides.findIndex((s) => s.q === dq && s.r === dr)
	return idx >= 0 ? idx : undefined
}

function ensureFlowBuilder(
	builders: Map<AxialKey, TileRiverFlowBuilder>,
	key: AxialKey
): TileRiverFlowBuilder {
	let b = builders.get(key)
	if (!b) {
		b = {
			upstream: new Set(),
			downstream: new Set(),
			rankFromSource: Number.NEGATIVE_INFINITY,
			rankToSea: Number.POSITIVE_INFINITY,
		}
		builders.set(key, b)
	}
	return b
}

function mergeSeaDownstreamForLandTerminal(
	key: AxialKey,
	tiles: Map<AxialKey, TileField>,
	config: TerrainConfig,
	builders: Map<AxialKey, TileRiverFlowBuilder>
): void {
	const tile = tiles.get(key)
	if (!tile || tile.height < config.seaLevel) return
	const coord = axial.coord(key)
	const b = ensureFlowBuilder(builders, key)
	if (b.downstream.size > 0) return
	for (const neighbor of axial.neighbors(coord)) {
		const nk = axial.key(neighbor)
		const nt = tiles.get(nk)
		if (!nt || nt.height >= config.seaLevel) continue
		const d = directionFromTileToNeighbor(coord, nk)
		if (d !== undefined) b.downstream.add(d)
	}
}

function terminalKindRank(k: HydrologyPathTerminalKind): number {
	return k === 'sea' ? 2 : k === 'coast' ? 1 : 0
}

function mergePathTerminalKind(
	prev: HydrologyPathTerminalKind | undefined,
	next: HydrologyPathTerminalKind
): HydrologyPathTerminalKind {
	if (prev === undefined) return next
	return terminalKindRank(next) > terminalKindRank(prev) ? next : prev
}

function finalizeRiverFlow(
	builders: Map<AxialKey, TileRiverFlowBuilder>
): Map<AxialKey, TileRiverFlow> | undefined {
	if (builders.size === 0) return undefined
	const out = new Map<AxialKey, TileRiverFlow>()
	for (const [key, b] of builders) {
		const rankToSea = Number.isFinite(b.rankToSea) ? b.rankToSea : 0
		const rankFromSource = Number.isFinite(b.rankFromSource) ? Math.max(0, b.rankFromSource) : 0
		const base: TileRiverFlow = {
			upstreamDirections: [...b.upstream].sort((a, c) => a - c),
			downstreamDirections: [...b.downstream].sort((a, c) => a - c),
			rankFromSource,
			rankToSea,
		}
		out.set(
			key,
			b.pathTerminalKind !== undefined ? { ...base, pathTerminalKind: b.pathTerminalKind } : base
		)
	}
	return out
}

interface FrontierNode {
	key: AxialKey
	cost: number
	steps: number
}

function addEdgeFlux(
	edges: Map<EdgeKey, EdgeField>,
	key: EdgeKey,
	increment: number,
	h1: number,
	h2: number
): void {
	const prev = edges.get(key)
	const flux = (prev?.flux ?? 0) + increment
	const slope = Math.abs(h1 - h2)
	const width = Math.sqrt(flux) * t.edgeFluxWidthSqrtScale + t.edgeFluxWidthOffset
	const depth = Math.min(
		t.edgeFluxDepthCap,
		t.edgeFluxDepthFluxScale * flux + t.edgeFluxDepthSlopeScale * slope
	)
	edges.set(key, { flux, depth, width, slope })
}

/**
 * Run probabilistic hydrology with bounded path search and one-ring bank propagation.
 * Only tiles present in `tiles` participate in routing, which keeps the result compatible
 * with fixed-board generation while leaving cross-frontier streaming hydrology for later.
 */
export function runHydrologyDetailed(
	tiles: Map<AxialKey, TileField>,
	seed: number,
	config: TerrainConfig
): HydrologyResult {
	const result: HydrologyResult = {
		edges: new Map<EdgeKey, EdgeField>(),
		banks: new Map<AxialKey, number>(),
		channels: new Set<AxialKey>(),
		channelInfluence: new Map<AxialKey, number>(),
	}
	const flowBuilders = new Map<AxialKey, TileRiverFlowBuilder>()
	const tileKeys = new Set(tiles.keys())

	for (const [tileKey, tile] of tiles) {
		const coord = axial.coord(tileKey)
		if (!isSpring(coord, tile.height, seed, config)) continue
		const path = traceFromSpring(tileKey, coord, tiles, tileKeys, config)
		if (!path) continue
		const terminalKind = pathTerminalKindFromPath(path, tiles, config)
		applyRiverPath(path, tiles, result, config, flowBuilders, terminalKind)
	}

	const riverFlow = finalizeRiverFlow(flowBuilders)
	if (riverFlow) {
		result.riverFlow = riverFlow
	}
	return result
}

export function runHydrology(
	tiles: Map<AxialKey, TileField>,
	seed: number,
	config: TerrainConfig
): Map<EdgeKey, EdgeField> {
	return runHydrologyDetailed(tiles, seed, config).edges
}

function traceFromSpring(
	startKey: AxialKey,
	startCoord: AxialCoord,
	tiles: Map<AxialKey, TileField>,
	tileKeys: Set<AxialKey>,
	config: TerrainConfig
): AxialKey[] | undefined {
	const frontier: FrontierNode[] = [{ key: startKey, cost: 0, steps: 0 }]
	const costs = new Map<AxialKey, number>([[startKey, 0]])
	const stepsTo = new Map<AxialKey, number>([[startKey, 0]])
	const previous = new Map<AxialKey, AxialKey>()

	let bestGoal: FrontierNode | undefined

	while (frontier.length > 0) {
		let bestIndex = 0
		for (let i = 1; i < frontier.length; i++) {
			if (frontier[i]!.cost < frontier[bestIndex]!.cost) bestIndex = i
		}
		const current = frontier.splice(bestIndex, 1)[0]!
		const tile = tiles.get(current.key)
		if (!tile) continue
		if (current.cost > (costs.get(current.key) ?? Number.POSITIVE_INFINITY)) continue

		if (current.key !== startKey && tile.height < config.seaLevel) {
			bestGoal = current
			break
		}
		if (current.steps >= config.hydrologyMaxTraceSteps) continue

		const currentCoord = axial.coord(current.key)
		const neighborCoords = [...axial.neighbors(currentCoord)].filter((coord) => {
			const key = axial.key(coord)
			return tileKeys.has(key) && axial.distance(coord, startCoord) <= config.hydrologyMaxTraceSteps
		})
		if (neighborCoords.length === 0) continue

		const minNeighborHeight = Math.min(
			...neighborCoords.map(
				(coord) => tiles.get(axial.key(coord))?.height ?? Number.POSITIVE_INFINITY
			)
		)

		for (const neighborCoord of neighborCoords) {
			const nextKey = axial.key(neighborCoord)
			const nextTile = tiles.get(nextKey)
			if (!nextTile) continue

			const nextSteps = current.steps + 1
			const nextCost = current.cost + transitionCost(tile, nextTile, minNeighborHeight)
			const prevCost = costs.get(nextKey)
			const prevSteps = stepsTo.get(nextKey)
			const improves =
				prevCost === undefined ||
				nextCost < prevCost - 1e-9 ||
				(Math.abs(nextCost - prevCost) <= 1e-9 &&
					nextSteps < (prevSteps ?? Number.POSITIVE_INFINITY))
			if (!improves) continue

			costs.set(nextKey, nextCost)
			stepsTo.set(nextKey, nextSteps)
			previous.set(nextKey, current.key)
			frontier.push({ key: nextKey, cost: nextCost, steps: nextSteps })
		}
	}

	if (!bestGoal) {
		let fallbackKey: AxialKey | undefined
		let fallbackCost = Number.POSITIVE_INFINITY
		for (const [k, c] of costs) {
			const t = tiles.get(k)
			if (!t || t.height < config.seaLevel) continue
			if (k === startKey) continue
			if (c < fallbackCost) {
				fallbackCost = c
				fallbackKey = k
			}
		}
		if (fallbackKey === undefined || !Number.isFinite(fallbackCost)) return undefined
		bestGoal = {
			key: fallbackKey,
			cost: fallbackCost,
			steps: stepsTo.get(fallbackKey) ?? 0,
		}
	}

	const path: AxialKey[] = []
	let current: AxialKey | undefined = bestGoal.key
	while (current) {
		path.push(current)
		current = previous.get(current)
	}
	path.reverse()
	trimSeaEntry(path, tiles, config)
	return path.length > MIN_TERMINAL_PATH_LENGTH ? path : undefined
}

function pathTerminalKindFromPath(
	path: AxialKey[],
	tiles: Map<AxialKey, TileField>,
	config: TerrainConfig
): HydrologyPathTerminalKind {
	const lastKey = path[path.length - 1]!
	const lastTile = tiles.get(lastKey)
	if (!lastTile) return 'inland'
	if (lastTile.height < config.seaLevel) return 'sea'
	const coord = axial.coord(lastKey)
	for (const neighbor of axial.neighbors(coord)) {
		const nt = tiles.get(axial.key(neighbor))
		if (nt && nt.height < config.seaLevel) return 'coast'
	}
	return 'inland'
}

function transitionCost(from: TileField, to: TileField, minNeighborHeight: number): number {
	const uphill = Math.max(0, to.height - from.height)
	const uphillPenalty =
		uphill === 0 ? 0 : t.uphillPenaltyInner + (uphill * t.uphillLinearFactor) ** 2
	const missedDescentPenalty =
		Math.max(0, to.height - minNeighborHeight) * t.missedDescentLinearFactor
	const nonDescendingPenalty = to.height >= from.height ? t.nonDescendingPenalty : 0
	return t.pathTransitionBase + uphillPenalty + missedDescentPenalty + nonDescendingPenalty
}

function trimSeaEntry(
	path: AxialKey[],
	tiles: Map<AxialKey, TileField>,
	config: TerrainConfig
): void {
	while (path.length > MIN_TERMINAL_PATH_LENGTH) {
		const lastKey = path[path.length - 1]!
		const lastCoord = axial.coord(lastKey)
		let oceanNeighbors = 0
		for (const neighbor of axial.neighbors(lastCoord)) {
			if ((tiles.get(axial.key(neighbor))?.height ?? Number.POSITIVE_INFINITY) < config.seaLevel) {
				oceanNeighbors++
			}
		}
		if (oceanNeighbors < t.trimSeaEntryOceanNeighborThreshold) break
		path.pop()
	}
}

function applyRiverPath(
	path: AxialKey[],
	tiles: Map<AxialKey, TileField>,
	result: HydrologyResult,
	config: TerrainConfig,
	flowBuilders: Map<AxialKey, TileRiverFlowBuilder>,
	pathTerminalKind: HydrologyPathTerminalKind
): void {
	for (let index = 0; index < path.length; index++) {
		const key = path[index]!
		const coord = axial.coord(key)
		const flow = ensureFlowBuilder(flowBuilders, key)
		flow.rankFromSource = Math.max(flow.rankFromSource, index)
		flow.rankToSea = Math.min(flow.rankToSea, path.length - 1 - index)

		const prevKey = index > 0 ? path[index - 1] : undefined
		const nextKey = index + 1 < path.length ? path[index + 1] : undefined
		if (prevKey) {
			const d = directionFromTileToNeighbor(coord, prevKey)
			if (d !== undefined) flow.upstream.add(d)
		}
		if (nextKey) {
			const d = directionFromTileToNeighbor(coord, nextKey)
			if (d !== undefined) flow.downstream.add(d)
		} else if (pathTerminalKind === 'coast' || pathTerminalKind === 'sea') {
			mergeSeaDownstreamForLandTerminal(key, tiles, config, flowBuilders)
		}

		if (index === path.length - 1) {
			flow.pathTerminalKind = mergePathTerminalKind(flow.pathTerminalKind, pathTerminalKind)
		}

		result.channels.add(key)
		const downstreamWeight =
			t.channelDownstreamWeightBase + (path.length - index) / Math.max(1, path.length)
		result.channelInfluence.set(
			key,
			Math.max(result.channelInfluence.get(key) ?? 0, downstreamWeight)
		)

		const neighbors = axial.neighbors(axial.coord(key))
		for (const neighbor of neighbors) {
			const neighborKey = axial.key(neighbor)
			if (neighborKey === prevKey || neighborKey === nextKey) continue
			if (!tiles.has(neighborKey)) continue
			if (result.channels.has(neighborKey)) continue
			const neighborTile = tiles.get(neighborKey)
			if (!neighborTile || neighborTile.height < config.seaLevel) continue
			const influence = 1 + (path.length - index) / path.length
			result.banks.set(neighborKey, Math.max(result.banks.get(neighborKey) ?? 0, influence))

			if (downstreamWeight <= t.channelHighDownstreamThreshold) continue
			for (const outer of axial.neighbors(neighbor)) {
				const outerKey = axial.key(outer)
				if (outerKey === key || outerKey === prevKey || outerKey === nextKey) continue
				if (!tiles.has(outerKey)) continue
				if (result.channels.has(outerKey)) continue
				const outerTile = tiles.get(outerKey)
				if (!outerTile || outerTile.height < config.seaLevel) continue
				const outerInfluence = influence * t.outerBankInfluenceScale
				result.banks.set(outerKey, Math.max(result.banks.get(outerKey) ?? 0, outerInfluence))
			}
		}

		if (!nextKey) continue
		const currentTile = tiles.get(key)
		const nextTile = tiles.get(nextKey)
		if (!currentTile || !nextTile) continue
		const ek = edgeKey(key, nextKey)
		const increment = (index + 1) * config.hydrologyFluxStepWeight
		addEdgeFlux(result.edges, ek, increment, currentTile.height, nextTile.height)
	}
}
