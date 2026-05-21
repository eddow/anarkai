/**
 * WASM field generator: produces TileField per hex coordinate using Rust/WASM.
 * This is a faster alternative to the CPU generator, using the same algorithms
 * implemented in Rust for better performance.
 */

import { edgeKey } from '../edge-key'
import { axial } from '../hex/axial'
import type { AxialCoord, AxialKey } from '../hex/types'
import { logTerrainProfile } from '../profile'
import type {
	BiomeHint,
	EdgeField,
	EdgeKey,
	TerrainConfig,
	TileField,
	TileRiverFlow,
} from '../types'
import { getWasmModule } from '../wasm-loader'

// Cache WasmTerrainConfig by hash of config to avoid 20+ property assignments per batch
const _wasmConfigCache = new Map<string, any>()
let _slowSectorBatchWarningEmitted = false

function nowMs(): number {
	return (globalThis as any).performance?.now() ?? Date.now()
}

function _hashConfig(c: TerrainConfig): string {
	return `${c.scale}|${c.octaves}|${c.persistence}|${c.lacunarity}|${c.seaLevel}|${c.temperatureScale}|${c.humidityScale}|${c.terrainTypeScale}|${c.rockyLevel}|${c.forestLevel}|${c.sandTemperature}|${c.sandHumidity}|${c.wetlandHumidity}|${c.forestHumidity}|${c.snowLevel}|${c.hydrologySourcesPerTile}|${c.hydrologyLandCeiling}|${c.hydrologyMaxTraceSteps}|${c.hydrologyFluxStepWeight}`
}

export function getCachedWasmTerrainConfig(config: TerrainConfig): any {
	const hash = _hashConfig(config)
	const cached = _wasmConfigCache.get(hash)
	if (cached) return cached

	const core = _core()
	const wc = new core.WasmTerrainConfig()
	wc.scale = config.scale
	wc.octaves = config.octaves
	wc.persistence = config.persistence
	wc.lacunarity = config.lacunarity
	wc.sea_level = config.seaLevel
	wc.temperature_scale = config.temperatureScale
	wc.humidity_scale = config.humidityScale
	wc.terrain_type_scale = config.terrainTypeScale
	wc.rocky_level = config.rockyLevel
	wc.forest_level = config.forestLevel
	wc.sand_temperature = config.sandTemperature
	wc.sand_humidity = config.sandHumidity
	wc.wetland_humidity = config.wetlandHumidity
	wc.forest_humidity = config.forestHumidity
	wc.snow_level = config.snowLevel
	wc.hydrology_sources_per_tile = config.hydrologySourcesPerTile
	wc.hydrology_land_ceiling = config.hydrologyLandCeiling
	wc.hydrology_max_trace_steps = config.hydrologyMaxTraceSteps
	wc.hydrology_flux_step_weight = config.hydrologyFluxStepWeight
	_wasmConfigCache.set(hash, wc)
	return wc
}

/** Check if WASM field generation is available and ready to use. */
export function isWasmFieldGenerationAvailable(): boolean {
	try {
		return typeof globalThis.WebAssembly !== 'undefined'
	} catch {
		return false
	}
}

/**
 * Get the already-loaded WASM module.
 */
function _core(): any {
	return getWasmModule()
}

/**
 * Generate a single tile's fields using WASM (synchronous — WASM is preloaded).
 */
export function generateTileFieldWasm(
	seed: number,
	coord: AxialCoord,
	config: TerrainConfig
): TileField {
	const core = _core()
	const wasmConfig = getCachedWasmTerrainConfig(config)

	const result = core.wasm_generate_tile_field(coord.q, coord.r, BigInt(seed), wasmConfig)

	return {
		height: result.height,
		temperature: result.temperature,
		humidity: result.humidity,
		terrainType: result.terrain_type,
		rockyNoise: result.rocky_noise,
		sediment: result.sediment,
		waterTable: result.water_table,
	}
}

/**
 * Batch: generate fields for a set of coordinates in a single WASM call (synchronous).
 * WasmTerrainConfig is cached across calls with the same config.
 */
export function generateFieldsWasm(
	coords: Iterable<AxialCoord>,
	seed: number,
	config: TerrainConfig
): Map<AxialKey, TileField> {
	const startedAt = nowMs()
	const core = _core()
	const wasmConfig = getCachedWasmTerrainConfig(config)

	// Flatten all coords into [q, r, q, r, ...] — single WASM crossing
	const flatCoords: number[] = []
	for (const c of coords) flatCoords.push(c.q, c.r)
	const int32 = new Int32Array(flatCoords)
	const afterPackAt = nowMs()

	const tiles = new Map<AxialKey, TileField>()
	if (typeof core.wasm_generate_tile_fields_packed === 'function') {
		const values = core.wasm_generate_tile_fields_packed(int32, BigInt(seed), wasmConfig)
		const afterWasmAt = nowMs()
		for (let coordIndex = 0, valueIndex = 0; coordIndex < flatCoords.length; coordIndex += 2) {
			const key = axial.key({ q: flatCoords[coordIndex]!, r: flatCoords[coordIndex + 1]! })
			tiles.set(key, {
				height: values[valueIndex]!,
				temperature: values[valueIndex + 1]!,
				humidity: values[valueIndex + 2]!,
				terrainType: values[valueIndex + 3]!,
				rockyNoise: values[valueIndex + 4]!,
				sediment: values[valueIndex + 5]!,
				waterTable: values[valueIndex + 6]!,
			})
			valueIndex += 7
		}
		const completedAt = nowMs()
		logTerrainProfile(
			`[wasm:profile] Field batch: tiles=${tiles.size} mode=packed pack=${(afterPackAt - startedAt).toFixed(1)}ms wasm=${(afterWasmAt - afterPackAt).toFixed(1)}ms unpack=${(completedAt - afterWasmAt).toFixed(1)}ms total=${(completedAt - startedAt).toFixed(1)}ms values=${values.length}`
		)
		return tiles
	}

	const beforeWasmAt = nowMs()
	const results =
		typeof core.wasm_generate_tile_fields === 'function'
			? core.wasm_generate_tile_fields(int32, BigInt(seed), wasmConfig)
			: flatCoords.reduce<any[]>((acc, _, index) => {
					if (index % 2 !== 0) return acc
					acc.push(
						core.wasm_generate_tile_field(
							flatCoords[index],
							flatCoords[index + 1],
							BigInt(seed),
							wasmConfig
						)
					)
					return acc
				}, [])
	const afterWasmAt = nowMs()

	for (let index = 0; index < results.length; index++) {
		const key = axial.key({ q: flatCoords[index * 2]!, r: flatCoords[index * 2 + 1]! })
		const result = results[index]
		tiles.set(key, {
			height: result.height,
			temperature: result.temperature,
			humidity: result.humidity,
			terrainType: result.terrain_type,
			rockyNoise: result.rocky_noise,
			sediment: result.sediment,
			waterTable: result.water_table,
		})
	}
	const completedAt = nowMs()
	logTerrainProfile(
		`[wasm:profile] Field batch: tiles=${tiles.size} mode=object pack=${(afterPackAt - startedAt).toFixed(1)}ms wasm=${(afterWasmAt - beforeWasmAt).toFixed(1)}ms unpack=${(completedAt - afterWasmAt).toFixed(1)}ms total=${(completedAt - startedAt).toFixed(1)}ms`
	)
	return tiles
}

export interface WasmSectorCoord {
	q: number
	r: number
}

export interface WasmSectorFieldBatch {
	coords: AxialCoord[]
	tiles: Map<AxialKey, TileField>
	biomes: Map<AxialKey, BiomeHint>
	edges: Map<EdgeKey, EdgeField>
	banks: Map<AxialKey, number>
	channels: Set<AxialKey>
	channelInfluence: Map<AxialKey, number>
	riverFlow?: Map<AxialKey, TileRiverFlow>
	requestedSectorCount: number
	tileCount: number
	hydrologyTileCount: number
	riverEdgeCount: number
	channelCount: number
	maxAccumulation: number
	sectorStep: number
	padding: number
	hydrologyPadding: number
	timings: {
		packMs: number
		wasmMs: number
		unpackMs: number
		totalMs: number
	}
}

const BIOME_HINT_BY_WASM_INDEX: Record<number, BiomeHint> = {
	0: 'ocean',
	1: 'lake',
	2: 'river-bank',
	3: 'wetland',
	4: 'sand',
	5: 'grass',
	6: 'forest',
	7: 'rocky',
	8: 'snow',
}

/**
 * Batch: generate fields for sector interiors plus axial padding in a single WASM call.
 */
export function generateSectorFieldsWasm(
	sectors: Iterable<WasmSectorCoord>,
	sectorStep: number,
	padding: number,
	hydrologyPadding: number,
	seed: number,
	config: TerrainConfig
): WasmSectorFieldBatch {
	const startedAt = nowMs()
	const core = _core()
	const wasmConfig = getCachedWasmTerrainConfig(config)

	if (typeof core.wasm_generate_sector_fields_packed !== 'function') {
		throw new Error('WASM module does not expose wasm_generate_sector_fields_packed')
	}

	const flatSectors: number[] = []
	for (const sector of sectors) flatSectors.push(sector.q, sector.r)
	const packedSectors = new Int32Array(flatSectors)
	const afterPackAt = nowMs()
	const result = core.wasm_generate_sector_fields_packed(
		packedSectors,
		sectorStep,
		padding,
		hydrologyPadding,
		BigInt(seed),
		wasmConfig
	)
	const afterWasmAt = nowMs()
	const wasmMs = afterWasmAt - afterPackAt

	const coordsArray = result.coords as Int32Array
	const fieldsArray = result.fields as Float32Array
	const biomesArray = result.biomes as Uint8Array | undefined
	const edgeInts = result.riverEdgeInts as Int32Array | undefined
	const edgeFloats = result.riverEdgeFloats as Float32Array | undefined
	const channelInts = result.channelInts as Int32Array | undefined
	const channelFloats = result.channelFloats as Float32Array | undefined
	const bankCoords = result.bankCoords as Int32Array | undefined
	const bankInfluenceValues = result.bankInfluence as Float32Array | undefined
	const coords: AxialCoord[] = []
	const tiles = new Map<AxialKey, TileField>()
	const biomes = new Map<AxialKey, BiomeHint>()
	for (
		let tileIndex = 0, coordIndex = 0, fieldIndex = 0;
		coordIndex < coordsArray.length;
		tileIndex++, coordIndex += 2
	) {
		const coord = { q: coordsArray[coordIndex]!, r: coordsArray[coordIndex + 1]! }
		const key = axial.key(coord)
		coords.push(coord)
		tiles.set(key, {
			height: fieldsArray[fieldIndex]!,
			temperature: fieldsArray[fieldIndex + 1]!,
			humidity: fieldsArray[fieldIndex + 2]!,
			terrainType: fieldsArray[fieldIndex + 3]!,
			rockyNoise: fieldsArray[fieldIndex + 4]!,
			sediment: fieldsArray[fieldIndex + 5]!,
			waterTable: fieldsArray[fieldIndex + 6]!,
		})
		if (biomesArray) biomes.set(key, BIOME_HINT_BY_WASM_INDEX[biomesArray[tileIndex]!] ?? 'grass')
		fieldIndex += 7
	}
	const edges = new Map<EdgeKey, EdgeField>()
	if (edgeInts && edgeFloats) {
		for (
			let intIndex = 0, floatIndex = 0;
			intIndex < edgeInts.length;
			intIndex += 4, floatIndex += 4
		) {
			const from = { q: edgeInts[intIndex]!, r: edgeInts[intIndex + 1]! }
			const direction = edgeInts[intIndex + 2]!
			const to = axial.neighbors(from)[direction]
			if (!to) continue
			edges.set(edgeKey(axial.key(from), axial.key(to)), {
				flux: edgeFloats[floatIndex]!,
				width: edgeFloats[floatIndex + 1]!,
				depth: edgeFloats[floatIndex + 2]!,
				slope: edgeFloats[floatIndex + 3]!,
			})
		}
	}

	const banks = new Map<AxialKey, number>()
	if (bankCoords && bankInfluenceValues) {
		for (
			let bankIndex = 0, coordIndex = 0;
			coordIndex < bankCoords.length;
			bankIndex++, coordIndex += 2
		) {
			banks.set(
				axial.key({ q: bankCoords[coordIndex]!, r: bankCoords[coordIndex + 1]! }),
				bankInfluenceValues[bankIndex]!
			)
		}
	}

	const channels = new Set<AxialKey>()
	const channelInfluence = new Map<AxialKey, number>()
	const riverFlow = new Map<AxialKey, TileRiverFlow>()
	if (channelInts && channelFloats) {
		for (
			let intIndex = 0, floatIndex = 0;
			intIndex < channelInts.length;
			intIndex += 7, floatIndex += 2
		) {
			const key = axial.key({ q: channelInts[intIndex]!, r: channelInts[intIndex + 1]! })
			const upstreamMask = channelInts[intIndex + 2]!
			const downstreamMask = channelInts[intIndex + 3]!
			channels.add(key)
			channelInfluence.set(key, channelFloats[floatIndex + 1]!)
			riverFlow.set(key, {
				upstreamDirections: maskToDirections(upstreamMask),
				downstreamDirections: maskToDirections(downstreamMask),
				rankFromSource: channelInts[intIndex + 5]!,
				rankToSea: channelInts[intIndex + 6]!,
			})
		}
	}
	const completedAt = nowMs()
	logTerrainProfile(
		`[wasm:profile] Sector field batch: sectors=${flatSectors.length / 2} tiles=${tiles.size} hydroTiles=${Number(result.hydrologyTileCount ?? 0)} rivers=${edges.size}/${channels.size} padding=${padding}/${Number(result.hydrologyPadding ?? hydrologyPadding)} pack=${(afterPackAt - startedAt).toFixed(1)}ms wasm=${(afterWasmAt - afterPackAt).toFixed(1)}ms unpack=${(completedAt - afterWasmAt).toFixed(1)}ms total=${(completedAt - startedAt).toFixed(1)}ms values=${fieldsArray.length}`
	)
	if (!_slowSectorBatchWarningEmitted && wasmMs > 1000 && tiles.size > 0) {
		_slowSectorBatchWarningEmitted = true
		const tilesPerMs = tiles.size / wasmMs
		logTerrainProfile(
			`[wasm:diagnostic] Extremely slow sector batch detected (${wasmMs.toFixed(1)}ms for ${tiles.size} tiles, ${tilesPerMs.toFixed(3)} tiles/ms). This strongly suggests a debug/dev WASM build. Rebuild anarkai-core with release optimizations.`
		)
	}

	return {
		coords,
		tiles,
		biomes,
		edges,
		banks,
		channels,
		channelInfluence,
		riverFlow: riverFlow.size > 0 ? riverFlow : undefined,
		requestedSectorCount: Number(result.requestedSectorCount ?? flatSectors.length / 2),
		tileCount: Number(result.tileCount ?? tiles.size),
		hydrologyTileCount: Number(result.hydrologyTileCount ?? 0),
		riverEdgeCount: Number(result.riverEdgeCount ?? edges.size),
		channelCount: Number(result.channelCount ?? channels.size),
		maxAccumulation: Number(result.maxAccumulation ?? 0),
		sectorStep: Number(result.sectorStep ?? sectorStep),
		padding: Number(result.padding ?? padding),
		hydrologyPadding: Number(result.hydrologyPadding ?? hydrologyPadding),
		timings: {
			packMs: afterPackAt - startedAt,
			wasmMs: afterWasmAt - afterPackAt,
			unpackMs: completedAt - afterWasmAt,
			totalMs: completedAt - startedAt,
		},
	}
}

function maskToDirections(mask: number): number[] {
	const dirs: number[] = []
	for (let direction = 0; direction < 6; direction++) {
		if ((mask & (1 << direction)) !== 0) dirs.push(direction)
	}
	return dirs
}

/**
 * Batch async alias for backward compatibility with streaming paths that await.
 * Internally just calls the synchronous version.
 */
export async function generateFieldsWasmAsync(
	coords: Iterable<AxialCoord>,
	seed: number,
	config: TerrainConfig
): Promise<Map<AxialKey, TileField>> {
	return generateFieldsWasm(coords, seed, config)
}
