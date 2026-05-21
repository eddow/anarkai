import type { AxialCoord, AxialKey } from '../hex/types'
import type { FieldGenerationBackend, TerrainConfig, TileField } from '../types'
import { generateFieldsCpu, generateTileFieldCpu } from './cpu'

export {
	canUseWebGpuFields,
	createFieldGenerationShaderSource,
	disposeGpuFieldRuntime,
	FIELD_RESULT_STRIDE,
	FIELD_SHADER_ENTRYPOINT,
	generateFieldsGpu,
	generateTileFieldGpu,
	isGpuFieldRuntimeReady,
	type PackedFieldRequest,
	type PackedFieldResult,
	packFieldRequest,
	unpackFieldResult,
	warmGpuFieldRuntime,
} from './gpu'

import { generateFieldsGpu, generateTileFieldGpu } from './gpu'

import { generateFieldsWasm, generateTileFieldWasm, isWasmFieldGenerationAvailable } from './wasm'

export const AUTO_GPU_MIN_TILES = 64

// Export WASM functions for external use
export {
	generateFieldsWasm,
	generateSectorFieldsWasm,
	generateTileFieldWasm,
	getCachedWasmTerrainConfig,
	isWasmFieldGenerationAvailable,
	type WasmSectorCoord,
	type WasmSectorFieldBatch,
} from './wasm'

export function resolveFieldGenerationBackend(
	backend: FieldGenerationBackend | undefined
): Exclude<FieldGenerationBackend, 'auto'> {
	if (!backend || backend === 'auto') return 'wasm'
	return backend
}

export function resolveSyncFieldGenerationBackend(
	backend: FieldGenerationBackend | undefined
): Exclude<FieldGenerationBackend, 'auto'> {
	const resolved = resolveFieldGenerationBackend(backend)
	return resolved === 'gpu' ? 'cpu' : resolved
}

export function resolveAsyncFieldGenerationBackend(
	backend: FieldGenerationBackend | undefined,
	_tileCount = 0
): Exclude<FieldGenerationBackend, 'auto'> {
	if (!backend || backend === 'auto') {
		if (isWasmFieldGenerationAvailable()) return 'wasm'
		return 'cpu'
	}
	return backend
}

export function generateTileField(
	seed: number,
	coord: AxialCoord,
	config: TerrainConfig,
	backend: FieldGenerationBackend | undefined
): TileField {
	switch (resolveSyncFieldGenerationBackend(backend)) {
		case 'cpu':
			return generateTileFieldCpu(seed, coord, config)
	}
	return generateTileFieldCpu(seed, coord, config)
}

export async function generateTileFieldAsync(
	seed: number,
	coord: AxialCoord,
	config: TerrainConfig,
	backend: FieldGenerationBackend | undefined
): Promise<TileField> {
	const resolved = resolveAsyncFieldGenerationBackend(backend, 1)
	switch (resolved) {
		case 'gpu':
			return generateTileFieldGpu(seed, coord, config)
		case 'wasm':
			return generateTileFieldWasm(seed, coord, config)
		case 'cpu':
			return generateTileFieldCpu(seed, coord, config)
	}
	return generateTileFieldCpu(seed, coord, config)
}

export function generateFields(
	coords: Iterable<AxialCoord>,
	seed: number,
	config: TerrainConfig,
	backend: FieldGenerationBackend | undefined
): Map<AxialKey, TileField> {
	switch (resolveSyncFieldGenerationBackend(backend)) {
		case 'cpu':
			return generateFieldsCpu(coords, seed, config)
	}
	return generateFieldsCpu(coords, seed, config)
}

export async function generateFieldsAsync(
	coords: Iterable<AxialCoord>,
	seed: number,
	config: TerrainConfig,
	backend: FieldGenerationBackend | undefined
): Promise<Map<AxialKey, TileField>> {
	const packedCoords = Array.isArray(coords) ? coords : [...coords]
	const resolved = resolveAsyncFieldGenerationBackend(backend, packedCoords.length)
	switch (resolved) {
		case 'gpu':
			return generateFieldsGpu(packedCoords, seed, config)
		case 'wasm':
			return generateFieldsWasm(packedCoords, seed, config)
		case 'cpu':
			return generateFieldsCpu(packedCoords, seed, config)
	}
	return generateFieldsCpu(packedCoords, seed, config)
}
