import { defaultTerrainConfig } from 'engine-rules'
import type { AxialKey } from './hex/types'

// ─── Per-tile fields ─────────────────────────────────────────────

export interface TileField {
	height: number
	temperature: number
	humidity: number
	terrainType: number
	rockyNoise: number
	sediment: number
	waterTable: number
}

// ─── Per-edge fields (populated by hydrology, Phase 2) ──────────

/** Canonical edge key: sorted pair `"q1,r1-q2,r2"` with lower key first */
export type EdgeKey = string

export interface EdgeField {
	flux: number
	depth: number
	width: number
	slope: number
}

/** How a traced river path ends at this tile when it is a path endpoint (merged across paths). */
export type HydrologyPathTerminalKind = 'sea' | 'coast' | 'inland'

/**
 * Authoritative river path direction on a channel tile (neighbor direction indices 0..5).
 * Derived from hydrology traces; merged when multiple paths visit the same tile.
 */
export interface TileRiverFlow {
	readonly upstreamDirections: readonly number[]
	readonly downstreamDirections: readonly number[]
	/** Max path index from a spring among contributing paths (0 at source tiles). */
	readonly rankFromSource: number
	/** Min steps along a contributing path to reach sea (0 on sea tiles / path end). */
	readonly rankToSea: number
	/**
	 * When this tile is an endpoint of a traced path, how that path terminates.
	 * Omitted on older snapshots or non-endpoint tiles.
	 */
	readonly pathTerminalKind?: HydrologyPathTerminalKind
}

export interface TerrainHydrologySnapshot {
	banks: Map<AxialKey, number>
	channels: Set<AxialKey>
	channelInfluence: Map<AxialKey, number>
	/** Optional per-tile flow metadata from river tracing (undefined on older snapshots). */
	riverFlow?: Map<AxialKey, TileRiverFlow>
}

// ─── Per-vertex fields (optional, for lakes/deltas) ─────────────

/** Canonical vertex key: sorted triple of adjacent tile keys */
export type VertexKey = string

export interface VertexField {
	poolLevel: number
}

// ─── Snapshot ────────────────────────────────────────────────────

export interface TerrainSnapshot {
	seed: number
	tiles: Map<AxialKey, TileField>
	edges: Map<EdgeKey, EdgeField>
	biomes: Map<AxialKey, BiomeHint>
	hydrology: TerrainHydrologySnapshot
	vertices?: Map<VertexKey, VertexField>
}

export interface TerrainGenerationPhaseTimings {
	fieldGenerationMs: number
	hydrologyMs: number
	clippingMs: number
	totalMs: number
}

export interface HydratedRegionMetrics {
	requestedTileCount: number
	paddedTileCount: number
	emittedTileCount: number
	emittedEdgeCount: number
	paddingAmplification: number
	edgePerRequestedTile: number
	fieldBackendRequested: FieldGenerationBackend
	fieldBackendResolved: Exclude<FieldGenerationBackend, 'auto'>
	gpuRuntimeReadyAtStart: boolean
	timings: TerrainGenerationPhaseTimings
}

export type FieldGenerationBackend = 'auto' | 'cpu' | 'gpu'

// ─── Classification ──────────────────────────────────────────────

export type BiomeHint =
	| 'ocean'
	| 'lake'
	| 'river-bank'
	| 'wetland'
	| 'sand'
	| 'grass'
	| 'forest'
	| 'rocky'
	| 'snow'

// ─── Generation config ──────────────────────────────────────────

export interface TerrainConfig {
	/** Base Perlin scale for elevation/macro/rocky height synthesis. */
	scale: number
	/** Independent Perlin scale for grass-vs-forest regional typing. */
	terrainTypeScale: number
	octaves: number
	persistence: number
	lacunarity: number

	temperatureScale: number
	humidityScale: number

	/**
	 * All thresholds are absolute, calibrated against raw FBM output
	 * (approximately centered on 0, height ≈ [-0.28, 0.29], temp/humidity ≈ [-0.46, 0.46]).
	 * This is required for streaming: a tile's fields are deterministic from its
	 * coordinate and the seed alone, without knowing what other tiles exist.
	 */
	seaLevel: number
	snowLevel: number
	rockyLevel: number
	forestLevel: number
	sandTemperature: number
	sandHumidity: number
	wetlandHumidity: number
	forestHumidity: number

	/** Max probability weight at `hydrologyLandCeiling` (see §4.1 in PLAN). Typical 0.1–0.2. */
	hydrologySourcesPerTile: number
	/** Upper height bound for spring probability; must be > seaLevel. */
	hydrologyLandCeiling: number
	/** Max hops per river trace (bounded local descent). */
	hydrologyMaxTraceSteps: number
	/** Flux added to an edge at trace step `s` is `s * hydrologyFluxStepWeight`. */
	hydrologyFluxStepWeight: number
}

export const DEFAULT_TERRAIN_CONFIG: TerrainConfig = defaultTerrainConfig
