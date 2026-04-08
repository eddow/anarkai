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

/** Generate a single tile's fields. Pure function of (noise, coord, config). */
export function generateTileField(
	noise: PerlinNoise,
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

	return {
		height: (h0 + h1 + h2) / 3,
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
		sediment: 0,
		waterTable: 0,
	}
}

export function generateTileFieldCpu(
	seed: number,
	coord: AxialCoord,
	config: TerrainConfig
): TileField {
	return generateTileField(new PerlinNoise(seed), coord, config)
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
		tiles.set(axial.key(coord), generateTileField(noise, coord, config))
	}
	return tiles
}
