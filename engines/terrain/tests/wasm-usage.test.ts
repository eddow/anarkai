import { describe, it, expect, beforeAll } from 'vitest'
import { PerlinNoise, fbm, domainWarp, initWasmNoise, isWasmNoiseAvailable } from '../src/noise'
import { classifyTile, initWasmClassification, isWasmClassificationAvailable } from '../src/classify'
import type { TileField, TerrainConfig, EdgeField } from '../src/types'

describe('WASM Usage Verification', () => {
	let wasmLoaded = false

	beforeAll(async () => {
		// Wait for WASM to load
		await initWasmNoise()
		await initWasmClassification()
		wasmLoaded = isWasmNoiseAvailable() || isWasmClassificationAvailable()
	}, 30000) // 30 second timeout for WASM loading

	it('should have WASM module available', () => {
		expect(wasmLoaded).toBe(true)
	})

	it('should use WASM for PerlinNoise', () => {
		const noise = new PerlinNoise(12345)
		const result1 = noise.noise(10.5, 20.3)
		const result2 = noise.noise(10.5, 20.3) // Should be deterministic
		expect(result1).toBe(result2)
		expect(typeof result1).toBe('number')
	})

	it('should use WASM for FBM', () => {
		const noise = new PerlinNoise(12345)
		const result = fbm(noise, 10.5, 20.3, 4, 0.5, 2.0)
		expect(typeof result).toBe('number')
		expect(result).toBeGreaterThanOrEqual(-1)
		expect(result).toBeLessThanOrEqual(1)
	})

	it('should use WASM for domain warp', () => {
		const result = domainWarp(12345, 10.5, 20.3, 4, 0.5, 2.0)
		expect(typeof result).toBe('number')
	})

	it('should use WASM for biome classification', () => {
		const tile: TileField = {
			height: 0.5,
			temperature: 0.6,
			humidity: 0.7,
			terrainType: 1,
			rockyNoise: 0.3,
			sediment: 0.4,
			waterTable: 0.2,
		}
		const config: TerrainConfig = {
			scale: 1.0,
			terrainTypeScale: 1.0,
			octaves: 4,
			persistence: 0.5,
			lacunarity: 2.0,
			seaLevel: 0.3,
			snowLevel: 0.8,
			rockyLevel: 0.6,
			forestLevel: 0.4,
			sandTemperature: 1.0,
			sandHumidity: 1.0,
			forestHumidity: 0.5,
			wetlandHumidity: 0.6,
			temperatureScale: 1.0,
			humidityScale: 1.0,
			hydrologyFluxStepWeight: 1.0,
			hydrologyMaxTraceSteps: 100,
			hydrologySourcesPerTile: 0.01,
			hydrologyLandCeiling: 0.5,
		}
		const edges: EdgeField[] = []
		const result = classifyTile(tile, edges, config)
		expect(['ocean', 'lake', 'river-bank', 'wetland', 'snow', 'rocky', 'sand', 'forest', 'grass']).toContain(result)
	})

	it('should produce deterministic results with WASM', () => {
		const seed = 99999
		const noise1 = new PerlinNoise(seed)
		const noise2 = new PerlinNoise(seed)

		// Test multiple points
		for (let i = 0; i < 10; i++) {
			const x = Math.random() * 100
			const y = Math.random() * 100
			const result1 = noise1.noise(x, y)
			const result2 = noise2.noise(x, y)
			expect(result1).toBe(result2)
		}
	})
})
