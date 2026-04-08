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
	packFieldRequest,
	unpackFieldResult,
	warmGpuFieldRuntime,
	type PackedFieldRequest,
	type PackedFieldResult,
} from './gpu'
import {
	canUseWebGpuFields,
	generateFieldsGpu,
	generateTileFieldGpu,
	isGpuFieldRuntimeReady,
} from './gpu'

export const AUTO_GPU_MIN_TILES = 64

export function resolveFieldGenerationBackend(
	backend: FieldGenerationBackend | undefined
): Exclude<FieldGenerationBackend, 'auto'> {
	if (!backend || backend === 'auto') return 'cpu'
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
	tileCount = 0
): Exclude<FieldGenerationBackend, 'auto'> {
	if (!backend || backend === 'auto') {
		return canUseWebGpuFields() && isGpuFieldRuntimeReady() && tileCount >= AUTO_GPU_MIN_TILES
			? 'gpu'
			: 'cpu'
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
	switch (resolveAsyncFieldGenerationBackend(backend, 1)) {
		case 'gpu':
			return generateTileFieldGpu(seed, coord, config)
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
	switch (resolveAsyncFieldGenerationBackend(backend, packedCoords.length)) {
		case 'gpu':
			return generateFieldsGpu(packedCoords, seed, config)
		case 'cpu':
			return generateFieldsCpu(packedCoords, seed, config)
	}
	return generateFieldsCpu(packedCoords, seed, config)
}
