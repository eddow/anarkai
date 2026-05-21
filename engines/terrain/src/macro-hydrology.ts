import { getCachedWasmTerrainConfig } from './fields'
import { logTerrainProfile } from './profile'
import { type BiomeHint, DEFAULT_TERRAIN_CONFIG, type TerrainConfig } from './types'
import { getWasmModule } from './wasm-loader'

export interface TerrainMacroTile {
	q: number
	r: number
	height: number
	biome: BiomeHint
}

export interface TerrainMacroRiverSegment {
	fromQ: number
	fromR: number
	toQ: number
	toR: number
	flux: number
	width: number
	order: number
}

export interface TerrainMacroHydrologySnapshot {
	seed: number
	centerSector: { q: number; r: number }
	sectorRadius: number
	sectorStep: number
	macroStep: number
	macroTileCount: number
	riverSegmentCount: number
	maxAccumulation: number
	tiles: TerrainMacroTile[]
	segments: TerrainMacroRiverSegment[]
	timings: {
		wasmMs: number
		unpackMs: number
		totalMs: number
	}
}

export interface GenerateMacroHydrologyOptions {
	sectorRadius?: number
	sectorStep?: number
	macroStep?: number
	config?: Partial<TerrainConfig>
}

export const DEFAULT_MACRO_HYDROLOGY_SECTOR_RADIUS = 12
export const DEFAULT_MACRO_HYDROLOGY_SECTOR_STEP = 17
export const DEFAULT_MACRO_HYDROLOGY_STEP = 8

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

function nowMs(): number {
	return Date.now()
}

export function generateMacroHydrologyWasm(
	seed: number,
	centerSector: { q: number; r: number },
	options?: GenerateMacroHydrologyOptions
): TerrainMacroHydrologySnapshot {
	const startedAt = nowMs()
	const core = getWasmModule()
	if (typeof core.wasm_generate_macro_hydrology_packed !== 'function') {
		throw new Error('WASM module does not expose wasm_generate_macro_hydrology_packed')
	}
	const config = { ...DEFAULT_TERRAIN_CONFIG, ...options?.config }
	const wasmConfig = getCachedWasmTerrainConfig(config)
	const sectorRadius = options?.sectorRadius ?? DEFAULT_MACRO_HYDROLOGY_SECTOR_RADIUS
	const sectorStep = options?.sectorStep ?? DEFAULT_MACRO_HYDROLOGY_SECTOR_STEP
	const macroStep = options?.macroStep ?? DEFAULT_MACRO_HYDROLOGY_STEP
	const result = core.wasm_generate_macro_hydrology_packed(
		centerSector.q,
		centerSector.r,
		sectorRadius,
		sectorStep,
		macroStep,
		BigInt(seed),
		wasmConfig
	)
	const afterWasmAt = nowMs()
	const tileInts = result.tileInts as Int32Array
	const tileFloats = result.tileFloats as Float32Array
	const segmentInts = result.segmentInts as Int32Array
	const segmentFloats = result.segmentFloats as Float32Array
	const tiles: TerrainMacroTile[] = []
	for (let tileIndex = 0, intIndex = 0; intIndex < tileInts.length; tileIndex++, intIndex += 3) {
		tiles.push({
			q: tileInts[intIndex]!,
			r: tileInts[intIndex + 1]!,
			biome: BIOME_HINT_BY_WASM_INDEX[tileInts[intIndex + 2]!] ?? 'grass',
			height: tileFloats[tileIndex]!,
		})
	}
	const segments: TerrainMacroRiverSegment[] = []
	for (
		let segmentIndex = 0, intIndex = 0, floatIndex = 0;
		intIndex < segmentInts.length;
		segmentIndex++, intIndex += 5, floatIndex += 2
	) {
		segments.push({
			fromQ: segmentInts[intIndex]!,
			fromR: segmentInts[intIndex + 1]!,
			toQ: segmentInts[intIndex + 2]!,
			toR: segmentInts[intIndex + 3]!,
			order: segmentInts[intIndex + 4]!,
			flux: segmentFloats[floatIndex]!,
			width: segmentFloats[floatIndex + 1]!,
		})
	}
	const completedAt = nowMs()
	logTerrainProfile(
		`[wasm:profile] Macro hydrology: center=${centerSector.q},${centerSector.r} radius=${sectorRadius} macroStep=${macroStep} macroTiles=${Number(result.macroTileCount ?? 0)} rivers=${segments.length} wasm=${(afterWasmAt - startedAt).toFixed(1)}ms unpack=${(completedAt - afterWasmAt).toFixed(1)}ms total=${(completedAt - startedAt).toFixed(1)}ms`
	)
	return {
		seed,
		centerSector: {
			q: Number(result.centerSectorQ ?? centerSector.q),
			r: Number(result.centerSectorR ?? centerSector.r),
		},
		sectorRadius: Number(result.sectorRadius ?? sectorRadius),
		sectorStep: Number(result.sectorStep ?? sectorStep),
		macroStep: Number(result.macroStep ?? macroStep),
		macroTileCount: Number(result.macroTileCount ?? 0),
		riverSegmentCount: Number(result.riverSegmentCount ?? segments.length),
		maxAccumulation: Number(result.maxAccumulation ?? 0),
		tiles,
		segments,
		timings: {
			wasmMs: afterWasmAt - startedAt,
			unpackMs: completedAt - afterWasmAt,
			totalMs: completedAt - startedAt,
		},
	}
}
