export { classifyTile, type HydrologyClassification } from './classify'
export {
	canUseWebGpuFields,
	createFieldGenerationShaderSource,
	disposeGpuFieldRuntime,
	AUTO_GPU_MIN_TILES,
	FIELD_RESULT_STRIDE,
	FIELD_SHADER_ENTRYPOINT,
	generateFieldsAsync,
	generateFields,
	generateFieldsGpu,
	generateTileFieldAsync,
	generateTileField,
	generateTileFieldGpu,
	isGpuFieldRuntimeReady,
	packFieldRequest,
	resolveAsyncFieldGenerationBackend,
	resolveFieldGenerationBackend,
	resolveSyncFieldGenerationBackend,
	unpackFieldResult,
	warmGpuFieldRuntime,
	type PackedFieldRequest,
	type PackedFieldResult,
} from './fields'
export { generateFieldsCpu, generateTileFieldCpu } from './fields/cpu'
export {
	applyTileOverrides,
	createSnapshot,
	edgeKey,
	type GenerateOptions,
	generate,
	generateAsync,
	generateHydratedRegion,
	generateHydratedRegionAsync,
	generateHydratedRegionAsyncWithMetrics,
	generateHydratedRegionWithMetrics,
	generateRegion,
	generateRegionAsync,
	generateTile,
	type GenerateHydratedRegionOptions,
	type GenerateHydratedRegionWithMetricsResult,
	type MergeSnapshotResult,
	mergeSnapshotRegion,
	type PopulateSnapshotResult,
	populateSnapshot,
	populateSnapshotAsync,
	pruneSnapshot,
	type TileOverride,
} from './generate'
export * from './hex/index'
export { isSpring, runHydrology, runHydrologyDetailed, type HydrologyResult } from './hydrology'
export { fbm, PerlinNoise } from './noise'
export * from './types'
