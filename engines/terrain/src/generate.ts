import { streamHydrologyPadding } from 'engine-rules'
import { classifyTile } from './classify'
import { edgeKey } from './edge-key'
import {
	generateFields,
	generateFieldsAsync,
	generateTileField,
	isGpuFieldRuntimeReady,
	resolveAsyncFieldGenerationBackend,
	resolveSyncFieldGenerationBackend,
} from './fields'
import { axial } from './hex/axial'
import type { AxialCoord, AxialKey } from './hex/types'
import { runHydrologyDetailed } from './hydrology'
import {
	type BiomeHint,
	DEFAULT_TERRAIN_CONFIG,
	type EdgeField,
	type EdgeKey,
	type FieldGenerationBackend,
	type HydratedRegionMetrics,
	type TerrainConfig,
	type TerrainSnapshot,
	type TileField,
	type TileRiverFlow,
} from './types'

export { edgeKey } from './edge-key'

export interface GenerateOptions {
	config?: Partial<TerrainConfig>
	fieldBackend?: FieldGenerationBackend
	tileOverrides?: Iterable<TileOverride>
}

export interface GenerateHydratedRegionOptions extends GenerateOptions {
	hydrologyPadding?: number
}

export interface PopulateSnapshotResult {
	added: AxialKey[]
}

export interface MergeSnapshotResult {
	addedTiles: AxialKey[]
	removedTiles: AxialKey[]
}

export interface GenerateHydratedRegionWithMetricsResult {
	snapshot: TerrainSnapshot
	metrics: HydratedRegionMetrics
}

export interface TileOverride {
	coord: AxialCoord
	tile?: Partial<TileField>
	biome?: BiomeHint
}

function resolveConfig(options?: GenerateOptions): TerrainConfig {
	return { ...DEFAULT_TERRAIN_CONFIG, ...options?.config }
}

function assertSnapshot(snapshot: TerrainSnapshot): void {
	if (!Number.isFinite(snapshot.seed)) {
		throw new Error('Invalid TerrainSnapshot: seed must be a finite number')
	}
	if (!(snapshot.tiles instanceof Map)) {
		throw new Error('Invalid TerrainSnapshot: tiles must be a Map')
	}
	if (!(snapshot.edges instanceof Map)) {
		throw new Error('Invalid TerrainSnapshot: edges must be a Map')
	}
	if (!(snapshot.biomes instanceof Map)) {
		throw new Error('Invalid TerrainSnapshot: biomes must be a Map')
	}
	if (
		!(snapshot.hydrology?.banks instanceof Map) ||
		!(snapshot.hydrology?.channels instanceof Set) ||
		!(snapshot.hydrology?.channelInfluence instanceof Map)
	) {
		throw new Error(
			'Invalid TerrainSnapshot: hydrology must contain banks, channels, and channelInfluence'
		)
	}
	if (
		snapshot.hydrology.riverFlow !== undefined &&
		!(snapshot.hydrology.riverFlow instanceof Map)
	) {
		throw new Error('Invalid TerrainSnapshot: hydrology.riverFlow must be a Map when present')
	}
}

export function createSnapshot(seed: number): TerrainSnapshot {
	if (!Number.isFinite(seed)) {
		throw new Error('Invalid seed: expected a finite number')
	}
	return {
		seed,
		tiles: new Map<AxialKey, ReturnType<typeof generateTileField>>(),
		edges: new Map<EdgeKey, EdgeField>(),
		biomes: new Map<AxialKey, BiomeHint>(),
		hydrology: {
			banks: new Map(),
			channels: new Set(),
			channelInfluence: new Map(),
		},
	}
}

/**
 * Populate an existing snapshot with missing tile fields + provisional local biomes.
 * Hydrology/edges are intentionally not updated here.
 */
export function populateSnapshot(
	snapshot: TerrainSnapshot,
	coords: Iterable<AxialCoord>,
	options?: GenerateOptions
): PopulateSnapshotResult {
	assertSnapshot(snapshot)
	const config = resolveConfig(options)
	const added: AxialKey[] = []

	for (const coord of coords) {
		const key = axial.key(coord)
		if (snapshot.tiles.has(key)) continue
		const tile = generateTileField(snapshot.seed, coord, config, options?.fieldBackend)
		snapshot.tiles.set(key, tile)
		snapshot.biomes.set(key, classifyTile(tile, [], config))
		added.push(key)
	}

	return { added }
}

export async function populateSnapshotAsync(
	snapshot: TerrainSnapshot,
	coords: Iterable<AxialCoord>,
	options?: GenerateOptions
): Promise<PopulateSnapshotResult> {
	assertSnapshot(snapshot)
	const config = resolveConfig(options)
	const missing: AxialCoord[] = []
	const added: AxialKey[] = []

	for (const coord of coords) {
		const key = axial.key(coord)
		if (snapshot.tiles.has(key)) continue
		missing.push(coord)
		added.push(key)
	}

	if (missing.length === 0) return { added: [] }

	const tiles = await generateFieldsAsync(missing, snapshot.seed, config, options?.fieldBackend)
	for (const coord of missing) {
		const key = axial.key(coord)
		const tile = tiles.get(key)
		if (!tile) continue
		snapshot.tiles.set(key, tile)
		snapshot.biomes.set(key, classifyTile(tile, [], config))
	}

	return { added }
}

export function applyTileOverrides(
	snapshot: TerrainSnapshot,
	overrides: Iterable<TileOverride>,
	options?: GenerateOptions
): PopulateSnapshotResult {
	assertSnapshot(snapshot)
	const config = resolveConfig(options)
	const added: AxialKey[] = []

	for (const override of overrides) {
		const key = axial.key(override.coord)
		let tile = snapshot.tiles.get(key)
		if (!tile) {
			tile = generateTileField(snapshot.seed, override.coord, config, options?.fieldBackend)
			snapshot.tiles.set(key, tile)
			added.push(key)
		}

		const patchedTile: TileField = {
			...tile,
			...override.tile,
		}
		snapshot.tiles.set(key, patchedTile)
		snapshot.biomes.set(key, override.biome ?? classifyTile(patchedTile, [], config))
	}

	return { added }
}

/**
 * Generate a terrain snapshot for an arbitrary coordinate set.
 * Uses incremental snapshot population and does not run hydrology.
 */
export function generateRegion(
	seed: number,
	coords: Iterable<AxialCoord>,
	options?: GenerateOptions
): TerrainSnapshot {
	const tileOverrides = options?.tileOverrides ? [...options.tileOverrides] : undefined
	const snapshot = createSnapshot(seed)
	populateSnapshot(snapshot, coords, options)
	if (tileOverrides) {
		applyTileOverrides(snapshot, tileOverrides, options)
	}
	return snapshot
}

export async function generateRegionAsync(
	seed: number,
	coords: Iterable<AxialCoord>,
	options?: GenerateOptions
): Promise<TerrainSnapshot> {
	const tileOverrides = options?.tileOverrides ? [...options.tileOverrides] : undefined
	const snapshot = createSnapshot(seed)
	await populateSnapshotAsync(snapshot, coords, options)
	if (tileOverrides) {
		applyTileOverrides(snapshot, tileOverrides, options)
	}
	return snapshot
}

export function generateHydratedRegion(
	seed: number,
	coords: Iterable<AxialCoord>,
	options?: GenerateHydratedRegionOptions
): TerrainSnapshot {
	return generateHydratedRegionWithMetrics(seed, coords, options).snapshot
}

export function generateHydratedRegionWithMetrics(
	seed: number,
	coords: Iterable<AxialCoord>,
	options?: GenerateHydratedRegionOptions
): GenerateHydratedRegionWithMetricsResult {
	const requestedCoords = [...coords]
	const config = resolveConfig(options)
	const tileOverrides = options?.tileOverrides ? [...options.tileOverrides] : undefined
	const requestedKeys = new Set(requestedCoords.map((coord) => axial.key(coord)))
	const paddedCoords = expandCoords(
		requestedCoords,
		options?.hydrologyPadding ?? streamHydrologyPadding
	)
	const requestedBackend = options?.fieldBackend ?? 'auto'
	const resolvedBackend = resolveSyncFieldGenerationBackend(options?.fieldBackend)
	const gpuRuntimeReadyAtStart = isGpuFieldRuntimeReady()

	const startedAt = nowMs()
	const tiles = generateFields(paddedCoords, seed, config, options?.fieldBackend)
	const afterFieldsAt = nowMs()
	const workingSnapshot: TerrainSnapshot = {
		seed,
		tiles,
		edges: new Map(),
		biomes: new Map(),
		hydrology: {
			banks: new Map(),
			channels: new Set(),
			channelInfluence: new Map(),
		},
	}
	if (tileOverrides) {
		applyTileOverrides(workingSnapshot, tileOverrides, options)
	}
	const hydrology = runHydrologyDetailed(tiles, seed, config)
	const afterHydrologyAt = nowMs()
	const snapshot = clipHydratedSnapshot(
		seed,
		requestedKeys,
		tiles,
		hydrology.edges,
		hydrology.banks,
		hydrology.channelInfluence,
		hydrology.riverFlow,
		config
	)
	const completedAt = nowMs()

	return {
		snapshot,
		metrics: {
			requestedTileCount: requestedKeys.size,
			paddedTileCount: paddedCoords.length,
			emittedTileCount: snapshot.tiles.size,
			emittedEdgeCount: snapshot.edges.size,
			paddingAmplification: requestedKeys.size === 0 ? 0 : paddedCoords.length / requestedKeys.size,
			edgePerRequestedTile: requestedKeys.size === 0 ? 0 : snapshot.edges.size / requestedKeys.size,
			fieldBackendRequested: requestedBackend,
			fieldBackendResolved: resolvedBackend,
			gpuRuntimeReadyAtStart,
			timings: {
				fieldGenerationMs: afterFieldsAt - startedAt,
				hydrologyMs: afterHydrologyAt - afterFieldsAt,
				clippingMs: completedAt - afterHydrologyAt,
				totalMs: completedAt - startedAt,
			},
		},
	}
}

export async function generateHydratedRegionAsync(
	seed: number,
	coords: Iterable<AxialCoord>,
	options?: GenerateHydratedRegionOptions
): Promise<TerrainSnapshot> {
	return (await generateHydratedRegionAsyncWithMetrics(seed, coords, options)).snapshot
}

export async function generateHydratedRegionAsyncWithMetrics(
	seed: number,
	coords: Iterable<AxialCoord>,
	options?: GenerateHydratedRegionOptions
): Promise<GenerateHydratedRegionWithMetricsResult> {
	const requestedCoords = [...coords]
	const config = resolveConfig(options)
	const tileOverrides = options?.tileOverrides ? [...options.tileOverrides] : undefined
	const requestedKeys = new Set(requestedCoords.map((coord) => axial.key(coord)))
	const paddedCoords = expandCoords(
		requestedCoords,
		options?.hydrologyPadding ?? streamHydrologyPadding
	)
	const requestedBackend = options?.fieldBackend ?? 'auto'
	const gpuRuntimeReadyAtStart = isGpuFieldRuntimeReady()
	const resolvedBackend = resolveAsyncFieldGenerationBackend(
		options?.fieldBackend,
		paddedCoords.length
	)

	const startedAt = nowMs()
	const tiles = await generateFieldsAsync(paddedCoords, seed, config, options?.fieldBackend)
	const afterFieldsAt = nowMs()
	const workingSnapshot: TerrainSnapshot = {
		seed,
		tiles,
		edges: new Map(),
		biomes: new Map(),
		hydrology: {
			banks: new Map(),
			channels: new Set(),
			channelInfluence: new Map(),
		},
	}
	if (tileOverrides) {
		applyTileOverrides(workingSnapshot, tileOverrides, options)
	}
	const hydrology = runHydrologyDetailed(tiles, seed, config)
	const afterHydrologyAt = nowMs()
	const snapshot = clipHydratedSnapshot(
		seed,
		requestedKeys,
		tiles,
		hydrology.edges,
		hydrology.banks,
		hydrology.channelInfluence,
		hydrology.riverFlow,
		config
	)
	const completedAt = nowMs()

	return {
		snapshot,
		metrics: {
			requestedTileCount: requestedKeys.size,
			paddedTileCount: paddedCoords.length,
			emittedTileCount: snapshot.tiles.size,
			emittedEdgeCount: snapshot.edges.size,
			paddingAmplification: requestedKeys.size === 0 ? 0 : paddedCoords.length / requestedKeys.size,
			edgePerRequestedTile: requestedKeys.size === 0 ? 0 : snapshot.edges.size / requestedKeys.size,
			fieldBackendRequested: requestedBackend,
			fieldBackendResolved: resolvedBackend,
			gpuRuntimeReadyAtStart,
			timings: {
				fieldGenerationMs: afterFieldsAt - startedAt,
				hydrologyMs: afterHydrologyAt - afterFieldsAt,
				clippingMs: completedAt - afterHydrologyAt,
				totalMs: completedAt - startedAt,
			},
		},
	}
}

export function mergeSnapshotRegion(
	snapshot: TerrainSnapshot,
	region: TerrainSnapshot
): MergeSnapshotResult {
	assertSnapshot(snapshot)
	assertSnapshot(region)
	if (snapshot.seed !== region.seed) {
		throw new Error(
			`Cannot merge TerrainSnapshot with mismatched seed: ${snapshot.seed} !== ${region.seed}`
		)
	}

	const addedTiles: AxialKey[] = []
	for (const [key, tile] of region.tiles) {
		if (!snapshot.tiles.has(key)) addedTiles.push(key)
		snapshot.tiles.set(key, tile)
	}
	for (const [key, biome] of region.biomes) {
		snapshot.biomes.set(key, biome)
	}
	for (const [key, edge] of region.edges) {
		snapshot.edges.set(key, edge)
	}
	for (const [key, influence] of region.hydrology.banks) {
		snapshot.hydrology.banks.set(key, influence)
	}
	for (const key of region.hydrology.channels) {
		snapshot.hydrology.channels.add(key)
	}
	for (const [key, influence] of region.hydrology.channelInfluence) {
		snapshot.hydrology.channelInfluence.set(key, influence)
	}
	if (region.hydrology.riverFlow) {
		if (!snapshot.hydrology.riverFlow) {
			snapshot.hydrology.riverFlow = new Map()
		}
		for (const [key, flow] of region.hydrology.riverFlow) {
			snapshot.hydrology.riverFlow.set(key, flow)
		}
	}
	return { addedTiles, removedTiles: [] }
}

export function pruneSnapshot(
	snapshot: TerrainSnapshot,
	retainedCoords: Iterable<AxialCoord>
): MergeSnapshotResult {
	assertSnapshot(snapshot)
	const retainedKeys = new Set<AxialKey>()
	for (const coord of retainedCoords) retainedKeys.add(axial.key(coord))

	const removedTiles: AxialKey[] = []
	for (const key of [...snapshot.tiles.keys()]) {
		if (retainedKeys.has(key)) continue
		snapshot.tiles.delete(key)
		snapshot.biomes.delete(key)
		snapshot.hydrology.banks.delete(key)
		snapshot.hydrology.channels.delete(key)
		snapshot.hydrology.channelInfluence.delete(key)
		snapshot.hydrology.riverFlow?.delete(key)
		removedTiles.push(key)
	}

	for (const key of [...snapshot.edges.keys()]) {
		const [a, b] = key.split('-') as [AxialKey, AxialKey]
		if (retainedKeys.has(a) || retainedKeys.has(b)) continue
		snapshot.edges.delete(key)
	}

	return { addedTiles: [], removedTiles }
}

/**
 * Generate fields + biome for a single tile (no hydrology — needs a full neighborhood / snapshot for rivers).
 */
export function generateTile(
	seed: number,
	coord: AxialCoord,
	config: TerrainConfig = DEFAULT_TERRAIN_CONFIG
) {
	const tile = generateTileField(seed, coord, config, 'cpu')
	const biome = classifyTile(tile, [], config)
	return { tile, biome }
}

/**
 * Generate a complete terrain snapshot for a hexagonal region.
 * Pipeline: hex enumeration → CPU fields → hydrology → classification.
 */
export function generate(
	seed: number,
	boardSize: number,
	options?: GenerateOptions
): TerrainSnapshot {
	const config = resolveConfig(options)
	const tileOverrides = options?.tileOverrides ? [...options.tileOverrides] : undefined

	const coords = [...axial.enum(boardSize - 1)]
	const tiles = generateFields(coords, seed, config, options?.fieldBackend)
	const snapshot: TerrainSnapshot = {
		seed,
		tiles,
		edges: new Map(),
		biomes: new Map(),
		hydrology: {
			banks: new Map(),
			channels: new Set(),
			channelInfluence: new Map(),
		},
	}
	if (tileOverrides) {
		applyTileOverrides(snapshot, tileOverrides, options)
	}
	const hydrology = runHydrologyDetailed(tiles, seed, config)
	const edges = hydrology.edges

	const biomes = new Map<AxialKey, BiomeHint>()
	for (const [key, tile] of tiles) {
		biomes.set(
			key,
			classifyTile(tile, edgesForTile(key, edges), config, {
				bankInfluence: hydrology.banks.get(key),
				channelInfluence: hydrology.channelInfluence.get(key),
			})
		)
	}

	for (const override of tileOverrides ?? []) {
		const key = axial.key(override.coord)
		const tile = tiles.get(key)
		if (!tile) continue
		biomes.set(
			key,
			override.biome ??
				classifyTile(tile, edgesForTile(key, edges), config, {
					bankInfluence: hydrology.banks.get(key),
					channelInfluence: hydrology.channelInfluence.get(key),
				})
		)
	}

	return {
		seed,
		tiles,
		edges,
		biomes,
		hydrology: {
			banks: hydrology.banks,
			channels: hydrology.channels,
			channelInfluence: hydrology.channelInfluence,
			riverFlow: hydrology.riverFlow,
		},
	}
}

export async function generateAsync(
	seed: number,
	boardSize: number,
	options?: GenerateOptions
): Promise<TerrainSnapshot> {
	const config = resolveConfig(options)
	const tileOverrides = options?.tileOverrides ? [...options.tileOverrides] : undefined

	const coords = [...axial.enum(boardSize - 1)]
	const tiles = await generateFieldsAsync(coords, seed, config, options?.fieldBackend)
	const snapshot: TerrainSnapshot = {
		seed,
		tiles,
		edges: new Map(),
		biomes: new Map(),
		hydrology: {
			banks: new Map(),
			channels: new Set(),
			channelInfluence: new Map(),
		},
	}
	if (tileOverrides) {
		applyTileOverrides(snapshot, tileOverrides, options)
	}
	const hydrology = runHydrologyDetailed(tiles, seed, config)
	const edges = hydrology.edges

	const biomes = new Map<AxialKey, BiomeHint>()
	for (const [key, tile] of tiles) {
		biomes.set(
			key,
			classifyTile(tile, edgesForTile(key, edges), config, {
				bankInfluence: hydrology.banks.get(key),
				channelInfluence: hydrology.channelInfluence.get(key),
			})
		)
	}

	for (const override of tileOverrides ?? []) {
		const key = axial.key(override.coord)
		const tile = tiles.get(key)
		if (!tile) continue
		biomes.set(
			key,
			override.biome ??
				classifyTile(tile, edgesForTile(key, edges), config, {
					bankInfluence: hydrology.banks.get(key),
					channelInfluence: hydrology.channelInfluence.get(key),
				})
		)
	}

	return {
		seed,
		tiles,
		edges,
		biomes,
		hydrology: {
			banks: hydrology.banks,
			channels: hydrology.channels,
			channelInfluence: hydrology.channelInfluence,
			riverFlow: hydrology.riverFlow,
		},
	}
}

function expandCoords(coords: Iterable<AxialCoord>, padding: number): AxialCoord[] {
	const expanded = new Map<AxialKey, AxialCoord>()
	for (const coord of coords) {
		for (const padded of axial.allTiles(coord, padding)) {
			expanded.set(axial.key(padded), padded)
		}
	}
	return [...expanded.values()]
}

function nowMs(): number {
	return globalThis.performance?.now() ?? Date.now()
}

function clipHydratedSnapshot(
	seed: number,
	requestedKeys: Set<AxialKey>,
	allTiles: Map<AxialKey, TileField>,
	allEdges: Map<EdgeKey, EdgeField>,
	banks: Map<AxialKey, number>,
	channelInfluence: Map<AxialKey, number>,
	riverFlow: Map<AxialKey, TileRiverFlow> | undefined,
	config: TerrainConfig
): TerrainSnapshot {
	const tiles = new Map<AxialKey, TileField>()
	const edges = new Map<EdgeKey, EdgeField>()
	const biomes = new Map<AxialKey, BiomeHint>()
	const clippedBanks = new Map<AxialKey, number>()
	const clippedChannels = new Set<AxialKey>()
	const clippedChannelInfluence = new Map<AxialKey, number>()
	const clippedRiverFlow = new Map<AxialKey, TileRiverFlow>()

	for (const key of requestedKeys) {
		const tile = allTiles.get(key)
		if (!tile) continue
		tiles.set(key, tile)
	}

	for (const [key, edge] of allEdges) {
		if (!edgeTouchesRequestedKey(key, requestedKeys)) continue
		edges.set(key, edge)
	}

	for (const [key, tile] of tiles) {
		const bankInfluence = banks.get(key)
		const tileChannelInfluence = channelInfluence.get(key)
		if (bankInfluence !== undefined) clippedBanks.set(key, bankInfluence)
		if (tileChannelInfluence !== undefined) clippedChannelInfluence.set(key, tileChannelInfluence)
		if (tileChannelInfluence !== undefined && tileChannelInfluence > 0) clippedChannels.add(key)
		const tileFlow = riverFlow?.get(key)
		if (tileFlow) clippedRiverFlow.set(key, tileFlow)
		biomes.set(
			key,
			classifyTile(tile, edgesForTile(key, edges), config, {
				bankInfluence,
				channelInfluence: tileChannelInfluence,
			})
		)
	}

	return {
		seed,
		tiles,
		edges,
		biomes,
		hydrology: {
			banks: clippedBanks,
			channels: clippedChannels,
			channelInfluence: clippedChannelInfluence,
			riverFlow: clippedRiverFlow.size > 0 ? clippedRiverFlow : undefined,
		},
	}
}

function edgeTouchesRequestedKey(key: EdgeKey, requestedKeys: Set<AxialKey>): boolean {
	const [a, b] = key.split('-') as [AxialKey, AxialKey]
	return requestedKeys.has(a) || requestedKeys.has(b)
}

function edgesForTile(tileKey: AxialKey, edges: Map<EdgeKey, EdgeField>): EdgeField[] {
	const coord = axial.coord(tileKey)
	const result: EdgeField[] = []
	for (const neighbor of axial.neighbors(coord)) {
		const edge = edges.get(edgeKey(tileKey, axial.key(neighbor)))
		if (edge) result.push(edge)
	}
	return result
}
