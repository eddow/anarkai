export { classifyTile, type HydrologyClassification } from './classify'
export {
	AUTO_GPU_MIN_TILES,
	canUseWebGpuFields,
	createFieldGenerationShaderSource,
	disposeGpuFieldRuntime,
	FIELD_RESULT_STRIDE,
	FIELD_SHADER_ENTRYPOINT,
	generateFields,
	generateFieldsAsync,
	generateFieldsGpu,
	generateFieldsWasm,
	generateTileField,
	generateTileFieldAsync,
	generateTileFieldGpu,
	generateTileFieldWasm,
	isGpuFieldRuntimeReady,
	isWasmFieldGenerationAvailable,
	type PackedFieldRequest,
	type PackedFieldResult,
	packFieldRequest,
	resolveAsyncFieldGenerationBackend,
	resolveFieldGenerationBackend,
	resolveSyncFieldGenerationBackend,
	unpackFieldResult,
	warmGpuFieldRuntime,
} from './fields'
export { generateFieldsCpu, generateTileFieldCpu } from './fields/cpu'
export {
	applyTileOverrides,
	createSnapshot,
	edgeKey,
	type GenerateHydratedRegionOptions,
	type GenerateHydratedRegionWithMetricsResult,
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
	type MergeSnapshotResult,
	mergeSnapshotRegion,
	type PopulateSnapshotResult,
	populateSnapshot,
	populateSnapshotAsync,
	pruneSnapshot,
	type TileOverride,
} from './generate'
export * from './hex/index'
export { type HydrologyResult, isSpring, runHydrology, runHydrologyDetailed } from './hydrology'
export { fbm, PerlinNoise, dumpNoiseProfile, resetNoiseProfile } from './noise'
export * from './types'
export {
	ensureWasmLoaded,
	getWasmModule,
	isWasmLoaded,
	loadWasmModule,
	wasmLoadReady,
} from './wasm-loader'
