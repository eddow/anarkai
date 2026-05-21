import { profileCall } from './noise'
import type { BiomeHint, EdgeField, TerrainConfig, TileField } from './types'
import { ensureWasmLoaded, getWasmModule, isWasmLoaded } from './wasm-loader'

export interface HydrologyClassification {
	bankInfluence?: number
	channelInfluence?: number
}

export async function initWasmClassification(): Promise<void> {
	await ensureWasmLoaded()
}

export function isWasmClassificationAvailable(): boolean {
	return isWasmLoaded()
}

/**
 * Classify a tile into a biome hint using Rust/WASM.
 */
export function classifyTile(
	tile: TileField,
	neighborEdges: EdgeField[],
	config: TerrainConfig,
	hydrology: HydrologyClassification = {}
): BiomeHint {
	const maxFlux = neighborEdges.reduce((m, e) => Math.max(m, e.flux), 0)
	const riverInfluence = hydrology.bankInfluence ?? 0
	const channelInfluence = hydrology.channelInfluence ?? 0

	const wasm = getWasmModule()
	const wasmResult = profileCall('wasm_classify_tile', () =>
		wasm.wasm_classify_tile(
			tile.height,
			tile.temperature,
			tile.humidity,
			tile.terrainType,
			tile.rockyNoise,
			tile.sediment,
			tile.waterTable,
			maxFlux,
			riverInfluence || null,
			channelInfluence || null,
			config.seaLevel,
			config.snowLevel,
			config.rockyLevel,
			config.forestLevel,
			config.wetlandHumidity
		)
	)

	const biomeMap: Record<number, BiomeHint> = {
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

	return biomeMap[wasmResult] || 'grass'
}
