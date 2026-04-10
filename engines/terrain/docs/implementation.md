# Terrain Implementation

This document describes the current implementation of `engines/terrain`: the exported functions, the internal pipeline, and the module boundaries that matter when extending the engine.

## Goals

`engine-terrain` is built around a few constraints:

- Deterministic output from `(seed, coord)` so streamed generation matches full-board generation.
- Pure tile-field generation before any neighborhood-dependent systems.
- Optional hydrology layered on top of already-generated tile fields.
- Snapshot-oriented APIs so callers can generate, merge, clip, and prune regions over time.

## Data Model

The core types live in `src/types.ts`.

### Tile data

`TileField`

- `height`
- `temperature`
- `humidity`
- `sediment`
- `waterTable`

Right now `height`, `temperature`, and `humidity` are generated directly. `sediment` and `waterTable` are present for later phases and currently default to `0`.

### Edge data

`EdgeField`

- `flux`
- `depth`
- `width`
- `slope`

Edges are generated only by hydrology. Tile-only generation paths leave `snapshot.edges` empty.

### Snapshot

`TerrainSnapshot`

- `seed`
- `tiles: Map<AxialKey, TileField>`
- `edges: Map<EdgeKey, EdgeField>`
- `biomes: Map<AxialKey, BiomeHint>`
- `vertices?: Map<VertexKey, VertexField>`

The snapshot is the unit we pass around for streaming and merging.

## Module Layout

### `src/generate.ts`

This is the orchestration layer and main public surface.

Key functions:

- `createSnapshot(seed)`
- `populateSnapshot(snapshot, coords, options)`
- `populateSnapshotAsync(snapshot, coords, options)`
- `applyTileOverrides(snapshot, overrides, options)`
- `generateRegion(seed, coords, options)`
- `generateRegionAsync(seed, coords, options)`
- `generateHydratedRegion(seed, coords, options)`
- `generateHydratedRegionWithMetrics(seed, coords, options)`
- `generateHydratedRegionAsync(seed, coords, options)`
- `generateHydratedRegionAsyncWithMetrics(seed, coords, options)`
- `generate(seed, boardSize, options)`
- `generateAsync(seed, boardSize, options)`
- `generateTile(seed, coord, config)`
- `mergeSnapshotRegion(snapshot, region)`
- `pruneSnapshot(snapshot, retainedCoords)`

### `src/fields/`

This layer is responsible for producing raw `TileField` values.

The current height model is a two-scale blend:

- a low-frequency macro elevation field that establishes broad coasts, basins, and mountain regions
- a reduced-strength local rotated-FBM field that adds local relief without dominating the overall shape

- `cpu.ts` contains the reference implementation.
- `gpu.ts` provides the async WebGPU path.
- `index.ts` resolves the backend and exposes batch/single-tile generation helpers.

Key functions:

- `generateTileField(seed, coord, config, backend)`
- `generateTileFieldAsync(seed, coord, config, backend)`
- `generateFields(coords, seed, config, backend)`
- `generateFieldsAsync(coords, seed, config, backend)`

Backend helpers:

- `resolveSyncFieldGenerationBackend(...)`
- `resolveAsyncFieldGenerationBackend(...)`
- `AUTO_GPU_MIN_TILES`

Important current behavior:

- Sync generation always resolves to CPU, even if `fieldBackend: 'gpu'` is requested.
- Async generation can use GPU only when the runtime is ready and the request is large enough.

### `src/noise.ts`

Noise primitives:

- `PerlinNoise`
- `fbm(...)`
- `createPermutationTable(seed)`

This is the deterministic numeric base for terrain fields.

### `src/classify.ts`

Biome classification turns a `TileField` plus optional hydrology context into a `BiomeHint`.

Key function:

- `classifyTile(tile, neighborEdges, config, hydrology?)`

Hydrology-aware inputs:

- neighboring edge flux
- `bankInfluence`
- `channelInfluence`

### `src/hydrology/`

Hydrology is a second pass over already-generated tiles.

- `springs.ts` decides whether a tile becomes a spring.
- `trace.ts` routes river paths and accumulates edge flux and bank/channel influence.

Key functions:

- `isSpring(coord, height, seed, config)`
- `runHydrology(tiles, seed, config)`
- `runHydrologyDetailed(tiles, seed, config)`

### `src/hex/`

Axial coordinate helpers and geometry utilities.

Important helpers used by terrain generation:

- `axial.key(coord)`
- `axial.coord(key)`
- `axial.enum(radius)`
- `axial.allTiles(center, radius)`
- `axial.neighbors(coord)`
- `axial.distance(a, b)`

## Generation Paths

### 1. Single tile

`generateTile(seed, coord, config)`

Pipeline:

1. `generateTileField(...)`
2. `classifyTile(tile, [], config)`

This path does not run hydrology, so the biome is provisional and intentionally unaware of rivers.

### 2. Arbitrary region without hydrology

`generateRegion(...)` and `populateSnapshot(...)`

Pipeline:

1. Resolve config from `DEFAULT_TERRAIN_CONFIG` plus overrides.
2. Generate missing `TileField`s for the requested coordinates.
3. Classify each tile with no edge context.
4. Optionally apply `tileOverrides`.

This is the streaming-safe path for raw terrain fields.

### 3. Full board with hydrology

`generate(seed, boardSize, options)`

Pipeline:

1. Enumerate hex coords with `axial.enum(boardSize - 1)`.
2. Generate all tile fields.
3. Optionally apply tile overrides.
4. Run `runHydrologyDetailed(...)`.
5. Re-classify all tiles with edge and bank/channel influence.
6. Return `{ seed, tiles, edges, biomes }`.

### 4. Hydrated arbitrary region

`generateHydratedRegion(...)`

Pipeline:

1. Copy the requested coords.
2. Expand them with `expandCoords(..., hydrologyPadding ?? 4)`.
3. Generate tile fields for the padded area.
4. Optionally apply tile overrides.
5. Run hydrology on the padded area.
6. Clip the result back to the requested keys.
7. Keep only edges touching the requested region.
8. Classify requested tiles with hydrated context.

This is how the engine preserves more stable border behavior for streamed river generation.

## Snapshot Operations

### `createSnapshot`

Creates an empty, validated container for long-lived generation state.

### `populateSnapshot`

- Only generates missing tile keys.
- Does not touch hydrology.
- Writes provisional biomes.

This is useful when the caller wants incremental field loading without recomputing the whole world.

### `applyTileOverrides`

Allows patching a generated tile and optionally forcing a biome. If the tile is missing, the base tile is generated first, then patched.

### `mergeSnapshotRegion`

Merges another snapshot with the same seed into a long-lived snapshot:

- tiles are inserted or replaced
- biomes are inserted or replaced
- edges are inserted or replaced

Seed mismatch throws.

### `pruneSnapshot`

Removes tiles not in the retained set and drops edges whose endpoints are both outside the retained set.

## Determinism Rules

The current implementation depends on a few invariants:

- Tile fields depend only on `seed`, `coord`, and config.
- Tile fields do not depend on board size or neighbor presence.
- Classification without hydrology depends only on the tile plus config.
- Hydrology depends on the generated tile set, so padding and clipping matter for streamed use.

The tests in `tests/snapshot.test.ts` enforce these assumptions, including parity between:

- small vs. large boards for overlapping coordinates
- sync vs. async generation
- full-board vs. partial region generation
- adjacent hydrated-region ownership and merge behavior

## Config

`DEFAULT_TERRAIN_CONFIG` defines:

- FBM controls: `scale`, `terrainTypeScale`, `octaves`, `persistence`, `lacunarity`
- climate scales: `temperatureScale`, `humidityScale`
- biome thresholds: `seaLevel`, `snowLevel`, `rockyLevel`, `forestLevel`, `sandTemperature`, `sandHumidity`, `wetlandHumidity`, `forestHumidity`
- hydrology controls: `hydrologySourcesPerTile`, `hydrologyLandCeiling`, `hydrologyMaxTraceSteps`, `hydrologyFluxStepWeight`

Thresholds are calibrated against raw FBM output, not board-normalized values. That is what keeps streamed generation compatible with whole-board generation.

## Extension Points

The safest places to extend the implementation are:

- `src/fields/cpu.ts` and `src/fields/gpu.ts` for new raw fields
- `src/classify.ts` for new biome rules
- `src/hydrology/trace.ts` for routing and edge metrics
- `src/generate.ts` for new snapshot-oriented workflows

When adding a new field or phase, the main question is whether it is:

- pure per-tile and safe to compute from `(seed, coord)` alone, or
- neighborhood-dependent and therefore part of a later pass like hydrology

That split is the main architectural seam in the current engine.
