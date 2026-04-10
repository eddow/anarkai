/**
 * CPU field generator: produces TileField per hex coordinate using Perlin FBM.
 * Uses the rotated-sample blending technique from ssh's PerlinTerrainGenerator.
 *
 * Values are raw/absolute FBM output (≈ centered on 0), NOT board-normalized.
 * This ensures streaming compatibility: the same (seed, coord) always produces
 * the same TileField regardless of which other tiles exist.
 */

import { axial } from '../hex/axial'
import type { AxialCoord, AxialKey } from '../hex/types'
import { fbm, PerlinNoise } from '../noise'
import type { TerrainConfig, TileField } from '../types'

const ANGLE1 = Math.PI / 6
const COS1 = Math.cos(ANGLE1)
const SIN1 = Math.sin(ANGLE1)
const ANGLE2 = -Math.PI / 6
const COS2 = Math.cos(ANGLE2)
const SIN2 = Math.sin(ANGLE2)
const LOCAL_RELIEF_STRENGTH = 0.58
const MACRO_HEIGHT_SCALE_FACTOR = 0.22
const MACRO_HEIGHT_OCTAVES = 3
const MACRO_HEIGHT_PERSISTENCE = 0.55
const MACRO_HEIGHT_LACUNARITY = 2.0
const MACRO_HEIGHT_STRENGTH = 0.32
const TERRAIN_REGION_SCALE_FACTOR = 0.16
const TERRAIN_REGION_JITTER = 0.35
const ROCKY_NOISE_SCALE_FACTOR = 8
const ROCKY_NOISE_OCTAVES = 4
const ROCKY_NOISE_PERSISTENCE = 0.5
const ROCKY_NOISE_LACUNARITY = 2.2
const MOUNTAIN_ROUGHNESS_STRENGTH = 1.35

function hash01(seed: number, x: number, y: number): number {
	let state = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0
	state = Math.imul(state ^ (state >>> 13), 1274126177) >>> 0
	return ((state ^ (state >>> 16)) >>> 0) / 4294967296
}

function terrainRegionType(seed: number, wx: number, wy: number, config: TerrainConfig): number {
	const regionScale = Math.max(config.scale * TERRAIN_REGION_SCALE_FACTOR, 1e-6)
	const sampleX = wx * regionScale
	const sampleY = wy * regionScale
	const baseX = Math.floor(sampleX)
	const baseY = Math.floor(sampleY)
	let bestDist = Number.POSITIVE_INFINITY
	let bestCellX = baseX
	let bestCellY = baseY

	for (let offsetX = -1; offsetX <= 1; offsetX++) {
		for (let offsetY = -1; offsetY <= 1; offsetY++) {
			const cellX = baseX + offsetX
			const cellY = baseY + offsetY
			const jitterX = (hash01(seed ^ 0x68bc21eb, cellX, cellY) - 0.5) * TERRAIN_REGION_JITTER
			const jitterY = (hash01(seed ^ 0x02e5be93, cellX, cellY) - 0.5) * TERRAIN_REGION_JITTER
			const centerX = cellX + 0.5 + jitterX
			const centerY = cellY + 0.5 + jitterY
			const dist = (sampleX - centerX) ** 2 + (sampleY - centerY) ** 2
			if (dist >= bestDist) continue
			bestDist = dist
			bestCellX = cellX
			bestCellY = cellY
		}
	}

	return hash01(seed ^ 0x7f4a7c15, bestCellX, bestCellY) * 2 - 1
}

/** Generate a single tile's fields. Pure function of (noise, coord, config). */
export function generateTileField(
	noise: PerlinNoise,
	seed: number,
	coord: AxialCoord,
	config: TerrainConfig
): TileField {
	const wx = coord.q * 0.866
	const wy = coord.r + coord.q * 0.5

	const x1 = wx * COS1 - wy * SIN1
	const y1 = wx * SIN1 + wy * COS1
	const x2 = wx * COS2 - wy * SIN2
	const y2 = wx * SIN2 + wy * COS2

	const h0 = fbm(
		noise,
		wx * config.scale,
		wy * config.scale,
		config.octaves,
		config.persistence,
		config.lacunarity
	)
	const h1 = fbm(
		noise,
		x1 * config.scale,
		y1 * config.scale,
		config.octaves,
		config.persistence,
		config.lacunarity
	)
	const h2 = fbm(
		noise,
		x2 * config.scale,
		y2 * config.scale,
		config.octaves,
		config.persistence,
		config.lacunarity
	)
	const macroScale = config.scale * MACRO_HEIGHT_SCALE_FACTOR
	const macro0 = fbm(
		noise,
		wx * macroScale,
		wy * macroScale,
		MACRO_HEIGHT_OCTAVES,
		MACRO_HEIGHT_PERSISTENCE,
		MACRO_HEIGHT_LACUNARITY
	)
	const macro1 = fbm(
		noise,
		x1 * macroScale,
		y1 * macroScale,
		MACRO_HEIGHT_OCTAVES,
		MACRO_HEIGHT_PERSISTENCE,
		MACRO_HEIGHT_LACUNARITY
	)
	const macro2 = fbm(
		noise,
		x2 * macroScale,
		y2 * macroScale,
		MACRO_HEIGHT_OCTAVES,
		MACRO_HEIGHT_PERSISTENCE,
		MACRO_HEIGHT_LACUNARITY
	)
	const localHeight = (h0 + h1 + h2) / 3
	const macroHeight = (macro0 + macro1 + macro2) / 3
	const terrainType = terrainRegionType(seed, wx, wy, {
		...config,
		scale: config.terrainTypeScale,
	})
	const rockyNoiseScale = config.scale * ROCKY_NOISE_SCALE_FACTOR
	const rockyNoise = fbm(
		noise,
		(wx * 0.8 + x1 * 0.2) * rockyNoiseScale,
		(wy * 0.8 + y2 * 0.2) * rockyNoiseScale,
		ROCKY_NOISE_OCTAVES,
		ROCKY_NOISE_PERSISTENCE,
		ROCKY_NOISE_LACUNARITY
	)
	const baseHeight = localHeight * LOCAL_RELIEF_STRENGTH + macroHeight * MACRO_HEIGHT_STRENGTH
	const mountainWeight = Math.max(0, baseHeight - config.rockyLevel)
	const height = baseHeight + rockyNoise * mountainWeight * MOUNTAIN_ROUGHNESS_STRENGTH

	return {
		// Use a broad landform field for regional shape, then add mountain roughness
		// only where elevation is already high enough to support it.
		height,
		temperature: fbm(
			noise,
			(wx * 0.9 + y1 * 0.1) * config.temperatureScale,
			(wy * 0.9 + x2 * 0.1) * config.temperatureScale,
			3,
			0.5,
			2.0
		),
		humidity: fbm(
			noise,
			(wx * 0.85 + x1 * 0.15) * config.humidityScale,
			(wy * 0.85 + y2 * 0.15) * config.humidityScale,
			3,
			0.5,
			2.0
		),
		terrainType,
		rockyNoise,
		sediment: 0,
		waterTable: 0,
	}
}

export function generateTileFieldCpu(
	seed: number,
	coord: AxialCoord,
	config: TerrainConfig
): TileField {
	return generateTileField(new PerlinNoise(seed), seed, coord, config)
}

/** Batch: generate fields for a set of coordinates. */
export function generateFieldsCpu(
	coords: Iterable<AxialCoord>,
	seed: number,
	config: TerrainConfig
): Map<AxialKey, TileField> {
	const noise = new PerlinNoise(seed)
	const tiles = new Map<AxialKey, TileField>()
	for (const coord of coords) {
		tiles.set(axial.key(coord), generateTileField(noise, seed, coord, config))
	}
	return tiles
}
