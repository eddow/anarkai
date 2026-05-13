/**
 * WASM field generator: produces TileField per hex coordinate using Rust/WASM.
 * This is a faster alternative to the CPU generator, using the same algorithms
 * implemented in Rust for better performance.
 */

import { axial } from '../hex/axial'
import type { AxialCoord, AxialKey } from '../hex/types'
import type { TerrainConfig, TileField } from '../types'
import { getWasmModule } from '../wasm-loader'

// Cache WasmTerrainConfig by hash of config to avoid 20+ property assignments per batch
const _wasmConfigCache = new Map<string, any>()

function _hashConfig(c: TerrainConfig): string {
	return `${c.scale}|${c.octaves}|${c.persistence}|${c.lacunarity}|${c.seaLevel}|${c.temperatureScale}|${c.humidityScale}|${c.terrainTypeScale}|${c.rockyLevel}|${c.forestLevel}|${c.sandTemperature}|${c.sandHumidity}|${c.wetlandHumidity}|${c.forestHumidity}|${c.snowLevel}|${c.hydrologySourcesPerTile}|${c.hydrologyLandCeiling}|${c.hydrologyMaxTraceSteps}|${c.hydrologyFluxStepWeight}`
}

function _getCachedWasmConfig(config: TerrainConfig): any {
	const hash = _hashConfig(config)
	let cached = _wasmConfigCache.get(hash)
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
	const wasmConfig = _getCachedWasmConfig(config)

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
	const core = _core()
	const wasmConfig = _getCachedWasmConfig(config)

	// Flatten all coords into [q, r, q, r, ...] — single WASM crossing
	const flatCoords: number[] = []
	for (const c of coords) flatCoords.push(c.q, c.r)
	const int32 = new Int32Array(flatCoords)

	const results =
		typeof core.wasm_generate_tile_fields === 'function'
			? core.wasm_generate_tile_fields(int32, BigInt(seed), wasmConfig)
			: flatCoords
					.reduce<any[]>((acc, _, index) => {
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

	const tiles = new Map<AxialKey, TileField>()
	for (let i = 0; i < results.length; i++) {
		const key = axial.key({ q: flatCoords[i * 2], r: flatCoords[i * 2 + 1] })
		const r = results[i]
		tiles.set(key, {
			height: r.height,
			temperature: r.temperature,
			humidity: r.humidity,
			terrainType: r.terrain_type,
			rockyNoise: r.rocky_noise,
			sediment: r.sediment,
			waterTable: r.water_table,
		})
	}
	return tiles
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
