/**
 * Bridge between engines/ssh and engines/core (Rust/WASM).
 *
 * In browser: uses the default async init which fetches the `.wasm` file via URL.
 * In Node/Vitest: uses `initSync` with raw bytes read from disk via `node:fs`.
 *
 * The Node code path uses direct `import('node:*')` — Vitest supports this.
 * TypeScript errors on `node:*` imports in the browser tsconfig are suppressed
 * with `@ts-expect-error` since this code only executes in Node.
 */

import type { InitOutput } from 'anarkai-core'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any

let wasm: InitOutput | null = null

/**
 * Initialize the WASM core (idempotent).
 * Must be called before any WASM functions are used.
 */
export async function initCore(): Promise<InitOutput> {
	if (wasm) return wasm

	// In Node.js/Vitest, use initSync with file-system buffer
	if (
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		typeof process !== 'undefined' &&
		typeof process?.versions?.node === 'string'
	) {
		// @ts-expect-error: node: imports only resolve in Node/Vitest, not browser builds
		const nodeFs = await import('node:fs')
		// @ts-expect-error: node: imports only resolve in Node/Vitest, not browser builds
		const nodePath = await import('node:path')
		// @ts-expect-error: node: imports only resolve in Node/Vitest, not browser builds
		const nodeUrl = await import('node:url')

		// From engines/ssh/src/lib/, go up 3 to engines/, then core/pkg/
		const wasmPath = nodePath.join(
			nodePath.dirname(nodeUrl.fileURLToPath(import.meta.url)),
			'..',
			'..',
			'..',
			'core',
			'pkg',
			'anarkai_core_bg.wasm'
		)
		const bytes = nodeFs.readFileSync(wasmPath)
		const core = await import('anarkai-core')
		wasm = core.initSync(bytes) as InitOutput
		return wasm
	}

	// Browser: default async init fetches the .wasm file
	const core = await import('anarkai-core')
	wasm = (await core.default()) as InitOutput
	return wasm
}

/**
 * Call the WASM `add` function (u32 → u32).
 * Verifies WASM integration end-to-end.
 */
export async function wasmAdd(a: number, b: number): Promise<number> {
	await initCore()
	const { add } = await import('anarkai-core')
	return add(a, b)
}

/**
 * Call the WASM `fbm_sample` function (fractal Brownian motion).
 * @param seed - The random seed (converted to BigInt for WASM)
 * @param x - X coordinate
 * @param y - Y coordinate
 * @param octaves - Number of octaves
 * @param persistence - Persistence factor
 * @param lacunarity - Lacunarity factor
 */
export async function wasmFbmSample(
	seed: number,
	x: number,
	y: number,
	octaves: number,
	persistence: number,
	lacunarity: number
): Promise<number> {
	await initCore()
	const { wasm_fbm_sample } = await import('anarkai-core')
	return wasm_fbm_sample(BigInt(seed), x, y, octaves, persistence, lacunarity)
}

/**
 * Call the WASM `perlin_sample` function.
 * @param seed - The random seed (converted to BigInt for WASM)
 * @param x - X coordinate
 * @param y - Y coordinate
 */
export async function wasmPerlinSample(seed: number, x: number, y: number): Promise<number> {
	await initCore()
	const { wasm_perlin_sample } = await import('anarkai-core')
	return wasm_perlin_sample(BigInt(seed), x, y)
}

/**
 * Call the WASM `generate_tile_field` function.
 * @param q - Axial q coordinate
 * @param r - Axial r coordinate
 * @param seed - The random seed (converted to BigInt for WASM)
 * @param config - Terrain configuration
 */
export async function wasmGenerateTileField(
	q: number,
	r: number,
	seed: number,
	config: {
		scale: number
		octaves: number
		persistence: number
		lacunarity: number
		sea_level: number
		temperature_scale: number
		humidity_scale: number
		terrain_type_scale: number
		rocky_level: number
		forest_level: number
		sand_temperature: number
		sand_humidity: number
		wetland_humidity: number
		forest_humidity: number
		snow_level: number
		hydrology_sources_per_tile: number
		hydrology_land_ceiling: number
		hydrology_max_trace_steps: number
		hydrology_flux_step_weight: number
	}
): Promise<{
	height: number
	temperature: number
	humidity: number
	terrain_type: number
	rocky_noise: number
	sediment: number
	water_table: number
}> {
	await initCore()
	const { wasm_generate_tile_field, WasmTerrainConfig } = await import('anarkai-core')

	const wasmConfig = new WasmTerrainConfig()
	wasmConfig.scale = config.scale
	wasmConfig.octaves = config.octaves
	wasmConfig.persistence = config.persistence
	wasmConfig.lacunarity = config.lacunarity
	wasmConfig.sea_level = config.sea_level
	wasmConfig.temperature_scale = config.temperature_scale
	wasmConfig.humidity_scale = config.humidity_scale
	wasmConfig.terrain_type_scale = config.terrain_type_scale
	wasmConfig.rocky_level = config.rocky_level
	wasmConfig.forest_level = config.forest_level
	wasmConfig.sand_temperature = config.sand_temperature
	wasmConfig.sand_humidity = config.sand_humidity
	wasmConfig.wetland_humidity = config.wetland_humidity
	wasmConfig.forest_humidity = config.forest_humidity
	wasmConfig.snow_level = config.snow_level
	wasmConfig.hydrology_sources_per_tile = config.hydrology_sources_per_tile
	wasmConfig.hydrology_land_ceiling = config.hydrology_land_ceiling
	wasmConfig.hydrology_max_trace_steps = config.hydrology_max_trace_steps
	wasmConfig.hydrology_flux_step_weight = config.hydrology_flux_step_weight

	const result = wasm_generate_tile_field(q, r, BigInt(seed), wasmConfig)

	return {
		height: result.height,
		temperature: result.temperature,
		humidity: result.humidity,
		terrain_type: result.terrain_type,
		rocky_noise: result.rocky_noise,
		sediment: result.sediment,
		water_table: result.water_table,
	}
}

/** Check whether WASM is available in this runtime. */
export function isWasmAvailable(): boolean {
	try {
		return typeof WebAssembly !== 'undefined'
	} catch {
		return false
	}
}
