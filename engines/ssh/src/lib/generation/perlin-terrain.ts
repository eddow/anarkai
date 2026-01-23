/**
 * Perlin noise-based terrain generation for hex boards
 * Based on Ken Perlin's improved noise algorithm
 */

import type { TerrainType } from 'ssh/src/lib/types'
import type { AxialCoord } from 'ssh/src/lib/utils/axial'

export interface TerrainConfig {
	// Noise parameters
	scale: number
	octaves: number
	persistence: number
	lacunarity: number

	// Terrain thresholds
	waterLevel: number
	grassLevel: number
	forestLevel: number
	rockyLevel: number
	sandLevel: number
	snowLevel: number

	// Biome modifiers
	temperatureScale: number
	humidityScale: number
}

export const DEFAULT_TERRAIN_CONFIG: TerrainConfig = {
	scale: 0.8,
	octaves: 5,
	persistence: 0.6,
	lacunarity: 2.2,
	waterLevel: 0.15,
	grassLevel: 0.35,
	forestLevel: 0.5,
	rockyLevel: 0.6,
	sandLevel: 0.25,
	snowLevel: 0.8,
	temperatureScale: 0.08,
	humidityScale: 0.08,
}

/**
 * Simple Perlin noise implementation
 */
class PerlinNoise {
	private readonly permutation: number[]
	private readonly p: number[]

	constructor(seed: number = 0) {
		// Create permutation table
		this.permutation = []
		for (let i = 0; i < 256; i++) {
			this.permutation[i] = i
		}

		// Shuffle using seed
		const rng = this.seededRandom(seed)
		for (let i = 255; i > 0; i--) {
			const j = Math.floor(rng() * (i + 1))
			;[this.permutation[i], this.permutation[j]] = [this.permutation[j], this.permutation[i]]
		}

		// Duplicate permutation array
		this.p = [...this.permutation, ...this.permutation]
	}

	private seededRandom(seed: number): () => number {
		let state = seed
		return () => {
			state = (state * 1664525 + 1013904223) % 4294967296
			return state / 4294967296
		}
	}

	private fade(t: number): number {
		return t * t * t * (t * (t * 6 - 15) + 10)
	}

	private lerp(t: number, a: number, b: number): number {
		return a + t * (b - a)
	}

	private grad(hash: number, x: number, y: number): number {
		const h = hash & 15
		const u = h < 8 ? x : y
		const v = h < 4 ? y : h === 12 || h === 14 ? x : 0
		return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
	}

	noise(x: number, y: number): number {
		const X = Math.floor(x) & 255
		const Y = Math.floor(y) & 255

		x -= Math.floor(x)
		y -= Math.floor(y)

		const u = this.fade(x)
		const v = this.fade(y)

		const A = this.p[X] + Y
		const AA = this.p[A]
		const AB = this.p[A + 1]
		const B = this.p[X + 1] + Y
		const BA = this.p[B]
		const BB = this.p[B + 1]

		return this.lerp(
			v,
			this.lerp(u, this.grad(this.p[AA], x, y), this.grad(this.p[BA], x - 1, y)),
			this.lerp(u, this.grad(this.p[AB], x, y - 1), this.grad(this.p[BB], x - 1, y - 1)),
		)
	}
}

/**
 * Perlin terrain generator for hex boards
 */
export class PerlinTerrainGenerator {
	private noise: PerlinNoise

	constructor(seed: number = 0) {
		this.noise = new PerlinNoise(seed)
	}

	private fbm(
		x: number,
		y: number,
		octaves: number,
		persistence: number,
		lacunarity: number,
	): number {
		let value = 0
		let amplitude = 1
		let frequency = 1
		let maxValue = 0

		for (let i = 0; i < octaves; i++) {
			value += this.noise.noise(x * frequency, y * frequency) * amplitude
			maxValue += amplitude
			amplitude *= persistence
			frequency *= lacunarity
		}

		return value / maxValue
	}

	/**
	 * Generate terrain type for a given hex coordinate
	 */
	generateTerrain(coord: AxialCoord, config: TerrainConfig = DEFAULT_TERRAIN_CONFIG): TerrainType {
		// Convert axial coordinates to world coordinates for noise sampling
		const worldX = coord.q * 0.866
		const worldY = coord.r + coord.q * 0.5

		// Reduce axis-aligned regularity by blending rotated FBM samples
		const angle1 = Math.PI / 6 // 30°
		const cos1 = Math.cos(angle1)
		const sin1 = Math.sin(angle1)
		const x1 = worldX * cos1 - worldY * sin1
		const y1 = worldX * sin1 + worldY * cos1

		const angle2 = -Math.PI / 6 // -30°
		const cos2 = Math.cos(angle2)
		const sin2 = Math.sin(angle2)
		const x2 = worldX * cos2 - worldY * sin2
		const y2 = worldX * sin2 + worldY * cos2

		// Generate base height using blended FBM
		const h0 = this.fbm(
			worldX * config.scale,
			worldY * config.scale,
			config.octaves,
			config.persistence,
			config.lacunarity,
		)
		const h1 = this.fbm(
			x1 * config.scale,
			y1 * config.scale,
			config.octaves,
			config.persistence,
			config.lacunarity,
		)
		const h2 = this.fbm(
			x2 * config.scale,
			y2 * config.scale,
			config.octaves,
			config.persistence,
			config.lacunarity,
		)
		const height = (h0 + h1 + h2) / 3

		// Generate temperature and humidity with different rotations to avoid alignment
		const t = this.fbm(
			(worldX * 0.9 + y1 * 0.1) * config.temperatureScale,
			(worldY * 0.9 + x2 * 0.1) * config.temperatureScale,
			3,
			0.5,
			2.0,
		)
		const temperature = t

		const h = this.fbm(
			(worldX * 0.85 + x1 * 0.15) * config.humidityScale,
			(worldY * 0.85 + y2 * 0.15) * config.humidityScale,
			3,
			0.5,
			2.0,
		)
		const humidity = h

		// Determine terrain based on height and biome factors
		return this.determineTerrainType(height, temperature, humidity, config)
	}

	private determineTerrainType(
		height: number,
		temperature: number,
		humidity: number,
		config: TerrainConfig,
	): TerrainType {
		// Normalize values to 0-1 range
		const normalizedHeight = (height + 1) / 2
		const normalizedTemp = (temperature + 1) / 2
		const normalizedHumidity = (humidity + 1) / 2

		// High altitude = snow
		if (normalizedHeight > config.snowLevel) {
			return 'snow'
		}

		// Low altitude = water
		if (normalizedHeight < config.waterLevel) {
			return 'water'
		}

		// Hot and dry = sand (more aggressive)
		if (normalizedTemp > 0.6 && normalizedHumidity < 0.4) {
			return 'sand'
		}

		// High altitude = rocky (more aggressive)
		if (normalizedHeight > config.rockyLevel) {
			return 'rocky'
		}

		// Forest conditions (more aggressive)
		if (normalizedHeight > config.forestLevel && normalizedHumidity > 0.4) {
			return 'forest'
		}

		// More forest in moderate heights with good humidity
		if (normalizedHeight > 0.3 && normalizedHeight < 0.6 && normalizedHumidity > 0.5) {
			return 'forest'
		}

		// Default to grass
		return 'grass'
	}

	/**
	 * Generate a height map for visualization
	 */
	generateHeightMap(coord: AxialCoord, config: TerrainConfig = DEFAULT_TERRAIN_CONFIG): number {
		const worldX = coord.q * 0.866
		const worldY = coord.r + coord.q * 0.5

		return this.fbm(
			worldX * config.scale,
			worldY * config.scale,
			config.octaves,
			config.persistence,
			config.lacunarity,
		)
	}

	/**
	 * Generate temperature and humidity values for biome analysis
	 */
	generateBiomeData(
		coord: AxialCoord,
		config: TerrainConfig = DEFAULT_TERRAIN_CONFIG,
	): {
		temperature: number
		humidity: number
	} {
		const worldX = coord.q * 0.866
		const worldY = coord.r + coord.q * 0.5

		return {
			temperature: this.fbm(
				worldX * config.temperatureScale,
				worldY * config.temperatureScale,
				3,
				0.5,
				2.0,
			),
			humidity: this.fbm(worldX * config.humidityScale, worldY * config.humidityScale, 3, 0.5, 2.0),
		}
	}
}

/**
 * Utility function to create a terrain generator with a specific seed
 */
export function createTerrainGenerator(seed: number = 0): PerlinTerrainGenerator {
	return new PerlinTerrainGenerator(seed)
}

/**
 * Utility function to generate terrain for multiple coordinates
 */
export function generateTerrainBatch(
	coords: AxialCoord[],
	generator: PerlinTerrainGenerator,
	config: TerrainConfig = DEFAULT_TERRAIN_CONFIG,
): Map<string, TerrainType> {
	const result = new Map<string, TerrainType>()

	for (const coord of coords) {
		const key = `${coord.q},${coord.r}`
		const terrain = generator.generateTerrain(coord, config)
		result.set(key, terrain)
	}

	return result
}
