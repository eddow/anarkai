/**
 * WASM field generator: produces TileField per hex coordinate using Rust/WASM.
 * This is a faster alternative to the CPU generator, using the same algorithms
 * implemented in Rust for better performance.
 */

import { axial } from '../hex/axial'
import type { AxialCoord, AxialKey } from '../hex/types'
import type { BiomeHint, TerrainConfig, TileField } from '../types'
import { getWasmModule } from '../wasm-loader'

// Cache WasmTerrainConfig by hash of config to avoid 20+ property assignments per batch
const _wasmConfigCache = new Map<string, any>()

function nowMs(): number {
	return (globalThis as any).performance?.now() ?? Date.now()
}

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
	const startedAt = nowMs()
	const core = _core()
	const wasmConfig = _getCachedWasmConfig(config)

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
		console.log(
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
	console.log(
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
	requestedSectorCount: number
	tileCount: number
	sectorStep: number
	padding: number
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
	seed: number,
	config: TerrainConfig
): WasmSectorFieldBatch {
	const startedAt = nowMs()
	const core = _core()
	const wasmConfig = _getCachedWasmConfig(config)

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
		BigInt(seed),
		wasmConfig
	)
	const afterWasmAt = nowMs()

	const coordsArray = result.coords as Int32Array
	const fieldsArray = result.fields as Float32Array
	const biomesArray = result.biomes as Uint8Array | undefined
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
	const completedAt = nowMs()
	console.log(
		`[wasm:profile] Sector field batch: sectors=${flatSectors.length / 2} tiles=${tiles.size} padding=${padding} pack=${(afterPackAt - startedAt).toFixed(1)}ms wasm=${(afterWasmAt - afterPackAt).toFixed(1)}ms unpack=${(completedAt - afterWasmAt).toFixed(1)}ms total=${(completedAt - startedAt).toFixed(1)}ms values=${fieldsArray.length}`
	)

	return {
		coords,
		tiles,
		biomes,
		requestedSectorCount: Number(result.requestedSectorCount ?? flatSectors.length / 2),
		tileCount: Number(result.tileCount ?? tiles.size),
		sectorStep: Number(result.sectorStep ?? sectorStep),
		padding: Number(result.padding ?? padding),
		timings: {
			packMs: afterPackAt - startedAt,
			wasmMs: afterWasmAt - afterPackAt,
			unpackMs: completedAt - afterWasmAt,
			totalMs: completedAt - startedAt,
		},
	}
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
