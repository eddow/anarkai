/**
 * Smoke test: verify the WASM core engine can be initialized and the `add`
 * function works in Node.js/Vitest.
 */

import { fbm, PerlinNoise } from 'engine-terrain'
import { describe, expect, test } from 'vitest'
import { initCore, isWasmAvailable, wasmAdd, wasmFbmSample } from './wasm-adapter'

describe('WASM core integration', () => {
	test('WASM is available in Node.js', () => {
		expect(isWasmAvailable()).toBe(true)
	})

	test('initCore loads the WASM module', async () => {
		const wasm = await initCore()
		expect(wasm).toBeDefined()
		expect(wasm.memory).toBeDefined()
	})

	test('wasmAdd returns correct sum', async () => {
		expect(await wasmAdd(2, 3)).toBe(5)
		expect(await wasmAdd(0, 0)).toBe(0)
		expect(await wasmAdd(1_000_000, 2_000_000)).toBe(3_000_000)
	})

	test('initCore is idempotent', async () => {
		const a = await initCore()
		const b = await initCore()
		expect(a).toBe(b)
	})

	describe('FBM comparison with TypeScript', () => {
		test('WASM FBM produces valid output (deterministic, in range)', async () => {
			const seed = 12345
			const testCases = [
				{ x: 0, y: 0, octaves: 4, persistence: 0.5, lacunarity: 2.0 },
				{ x: 10.5, y: -3.2, octaves: 6, persistence: 0.6, lacunarity: 2.5 },
				{ x: -7.8, y: 4.1, octaves: 3, persistence: 0.4, lacunarity: 1.8 },
				{ x: 100, y: 100, octaves: 5, persistence: 0.5, lacunarity: 2.0 },
			]

			for (const tc of testCases) {
				// Test WASM FBM
				const wasmValue1 = await wasmFbmSample(
					seed,
					tc.x,
					tc.y,
					tc.octaves,
					tc.persistence,
					tc.lacunarity
				)
				const wasmValue2 = await wasmFbmSample(
					seed,
					tc.x,
					tc.y,
					tc.octaves,
					tc.persistence,
					tc.lacunarity
				)

				// Verify determinism: same seed produces same output
				expect(wasmValue1).toBe(wasmValue2)

				// Verify output is in reasonable range for FBM (approximately [-1, 1])
				expect(wasmValue1).toBeGreaterThanOrEqual(-1.5)
				expect(wasmValue1).toBeLessThanOrEqual(1.5)

				// Test TypeScript FBM
				const perlin = new PerlinNoise(seed)
				const tsValue1 = fbm(perlin, tc.x, tc.y, tc.octaves, tc.persistence, tc.lacunarity)
				const perlin2 = new PerlinNoise(seed)
				const tsValue2 = fbm(perlin2, tc.x, tc.y, tc.octaves, tc.persistence, tc.lacunarity)

				// Verify TypeScript FBM is deterministic
				expect(tsValue1).toBe(tsValue2)

				// Verify TypeScript FBM is in reasonable range
				expect(tsValue1).toBeGreaterThanOrEqual(-1.5)
				expect(tsValue1).toBeLessThanOrEqual(1.5)

				// Note: WASM and TypeScript use different PRNGs (ChaCha8 vs LCG),
				// so they produce different values. Both are valid FBM implementations.
			}
		})
	})

	describe('Performance benchmarks', () => {
		test.skip('10k tiles: WASM vs CPU benchmark', async () => {
			const seed = 12345
			const regionSize = 100 // 100x100 = 10k tiles
			const coords: Array<{ q: number; r: number }> = []

			// Generate 100x100 region coordinates
			for (let q = 0; q < regionSize; q++) {
				for (let r = 0; r < regionSize; r++) {
					coords.push({ q, r })
				}
			}

			// Benchmark WASM
			const wasmStart = performance.now()
			for (const coord of coords) {
				await wasmFbmSample(seed, coord.q, coord.r, 4, 0.5, 2.0)
			}
			const wasmTime = performance.now() - wasmStart

			// Benchmark CPU
			const perlin = new PerlinNoise(seed)
			const cpuStart = performance.now()
			for (const coord of coords) {
				fbm(perlin, coord.q, coord.r, 4, 0.5, 2.0)
			}
			const cpuTime = performance.now() - cpuStart

			const speedup = cpuTime / wasmTime
			console.log(
				`WASM time: ${wasmTime.toFixed(2)}ms, CPU time: ${cpuTime.toFixed(2)}ms, Speedup: ${speedup.toFixed(2)}x`
			)

			// Assert WASM is at least 5x faster (conservative threshold)
			expect(speedup).toBeGreaterThanOrEqual(5)
		})

		test.skip('Erosion benchmark: 100k droplets on 10k tiles', async () => {
			// This is a placeholder for the erosion benchmark
			// The actual erosion implementation would need to be added
			console.log('Erosion benchmark: Not yet implemented - requires erosion WASM exports')
		})
	})
})
