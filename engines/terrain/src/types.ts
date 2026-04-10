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

export interface TerrainHydrologySnapshot {
	banks: Map<AxialKey, number>
	channels: Set<AxialKey>
	channelInfluence: Map<AxialKey, number>
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

export const DEFAULT_TERRAIN_CONFIG: TerrainConfig = {
	scale: 0.05,
	terrainTypeScale: 1.2,
	octaves: 5,
	persistence: 0.6,
	lacunarity: 2.2,
	temperatureScale: 0.08,
	humidityScale: 0.08,
	seaLevel: -0.02,
	snowLevel: 0.15,
	rockyLevel: 0.08,
	forestLevel: 0.0,
	sandTemperature: 0.15,
	sandHumidity: -0.05,
	wetlandHumidity: 0.15,
	forestHumidity: 0.03,
	hydrologySourcesPerTile: 0.1,
	hydrologyLandCeiling: 0.2,
	hydrologyMaxTraceSteps: 64,
	hydrologyFluxStepWeight: 6,
}
