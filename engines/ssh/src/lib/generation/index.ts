/**
 * Main generation system entry point
 * Coordinates all generation activities for the game
 */

import {
	type BiomeHint,
	generateMacroHydrologyWasm,
	generateHydratedRegion as generateTerrainRegion,
	generateHydratedRegionAsync as generateTerrainRegionAsync,
	generateSectorRegionAsync as generateTerrainSectorRegionAsync,
	type TerrainMacroHydrologySnapshot,
	type TerrainSectorCoord,
	type TileOverride,
} from 'engine-terrain'
import type { TerrainType } from 'ssh/types'
import type { AxialCoord } from 'ssh/utils'
import { profile } from '../dev/debug'
import { BoardGenerator, type GeneratedTileData } from './board'

export interface GameGenerationConfig {
	terrainSeed: number
	characterCount: number
	characterRadius?: number
}

export interface TerrainTerraformPatch {
	coord: [number, number]
	height?: number
	temperature?: number
	humidity?: number
	sediment?: number
	waterTable?: number
	terrain?: TerrainType
}

const terrainToBiome: Partial<Record<TerrainType, BiomeHint>> = {
	water: 'lake',
	sand: 'sand',
	grass: 'grass',
	forest: 'forest',
	rocky: 'rocky',
	snow: 'snow',
}

function beginGenerationProfile(label: string, payload?: unknown): (payload?: unknown) => void {
	return profile.terrainGeneration.begin?.(label, payload) ?? (() => {})
}

function toTileOverrides(terraforming: TerrainTerraformPatch[]): TileOverride[] {
	const overrides: TileOverride[] = []
	for (const patch of terraforming) {
		const tilePatch: TileOverride['tile'] = {}
		if (patch.height !== undefined) tilePatch.height = patch.height
		if (patch.temperature !== undefined) tilePatch.temperature = patch.temperature
		if (patch.humidity !== undefined) tilePatch.humidity = patch.humidity
		if (patch.sediment !== undefined) tilePatch.sediment = patch.sediment
		if (patch.waterTable !== undefined) tilePatch.waterTable = patch.waterTable

		overrides.push({
			coord: { q: patch.coord[0], r: patch.coord[1] },
			tile: Object.keys(tilePatch).length > 0 ? tilePatch : undefined,
			biome: patch.terrain ? terrainToBiome[patch.terrain] : undefined,
		})
	}
	return overrides
}

export class GameGenerator {
	generateRegion(
		config: GameGenerationConfig,
		coords: Iterable<AxialCoord>,
		terraforming: TerrainTerraformPatch[] = []
	): GeneratedTileData[] {
		const snapshot = generateTerrainRegion(config.terrainSeed, coords, {
			tileOverrides: toTileOverrides(terraforming),
		})

		const boardGenerator = new BoardGenerator()
		return boardGenerator.generateBoard(snapshot)
	}

	async generateRegionAsync(
		config: GameGenerationConfig,
		coords: Iterable<AxialCoord>,
		terraforming: TerrainTerraformPatch[] = []
	): Promise<GeneratedTileData[]> {
		const snapshot = await generateTerrainRegionAsync(config.terrainSeed, coords, {
			fieldBackend: 'auto',
			tileOverrides: toTileOverrides(terraforming),
		})

		const boardGenerator = new BoardGenerator()
		return boardGenerator.generateBoard(snapshot)
	}

	async generateSectorsAsync(
		config: GameGenerationConfig,
		sectors: Iterable<TerrainSectorCoord>,
		terraforming: TerrainTerraformPatch[] = [],
		options: { includeHydrology?: boolean } = {}
	): Promise<GeneratedTileData[]> {
		const sectorList = [...sectors]
		const endProfile = beginGenerationProfile('generateSectorsAsync', {
			sectors: sectorList.length,
			includeHydrology: options.includeHydrology ?? true,
		})
		const snapshot = await generateTerrainSectorRegionAsync(config.terrainSeed, sectorList, {
			fieldBackend: 'wasm',
			sectorStep: 17,
			padding: 1,
			hydrologyPadding: 24,
			includeHydrology: options.includeHydrology ?? true,
			tileOverrides: toTileOverrides(terraforming),
		})

		const boardGenerator = new BoardGenerator()
		const generated = boardGenerator.generateBoard(snapshot)
		endProfile({
			sectors: sectorList.length,
			tiles: generated.length,
			snapshotTiles: snapshot.tiles.size,
			edges: snapshot.edges.size,
			channels: snapshot.hydrology.channels.size,
		})
		return generated
	}

	async generateMacroHydrologyAsync(
		config: GameGenerationConfig,
		centerSector: TerrainSectorCoord,
		options: { macroStep?: number; sectorRadius?: number } = {}
	): Promise<TerrainMacroHydrologySnapshot> {
		const macroStep = options.macroStep ?? 8
		const sectorRadius = options.sectorRadius ?? 12
		const endProfile = beginGenerationProfile('generateMacroHydrologyAsync', {
			centerSector,
			sectorRadius,
			macroStep,
		})
		const snapshot = generateMacroHydrologyWasm(config.terrainSeed, centerSector, {
			sectorRadius,
			sectorStep: 17,
			macroStep,
		})
		endProfile({
			macroTiles: snapshot.macroTileCount,
			riverSegments: snapshot.riverSegmentCount,
			wasmMs: snapshot.timings.wasmMs,
			unpackMs: snapshot.timings.unpackMs,
			totalMs: snapshot.timings.totalMs,
		})
		return snapshot
	}
}

export { BoardGenerator, type GeneratedTileData } from './board'
export { type GeneratedCharacterData, PopulationGenerator } from './population'
export {
	type GeneratedSettlement,
	type SettlementRegion,
	type SettlementRegionNode,
	type SettlementRegionSet,
	type SettlementRegionSetPlan,
	generateSettlementRegionSetPlan,
	generateSettlementZonePlan,
	type SettlementGenerationOptions,
	type SettlementKind,
	type SettlementZonePlan,
} from './settlements'
