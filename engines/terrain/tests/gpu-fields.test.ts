import {
	canUseWebGpuFields,
	createFieldGenerationShaderSource,
	disposeGpuFieldRuntime,
	FIELD_RESULT_STRIDE,
	generateFieldsGpu,
	isGpuFieldRuntimeReady,
	packFieldRequest,
	unpackFieldResult,
	warmGpuFieldRuntime,
} from 'terrain/fields/gpu'
import {
	AUTO_GPU_MIN_TILES,
	resolveAsyncFieldGenerationBackend,
	resolveSyncFieldGenerationBackend,
} from 'terrain/fields'
import { generateFieldsCpu } from 'terrain/fields/cpu'
import { DEFAULT_TERRAIN_CONFIG } from 'terrain/types'
import { describe, expect, it } from 'vitest'

describe('GPU field groundwork', () => {
	it('packs coords and unpacks field result with the agreed stride', () => {
		const request = packFieldRequest(
			[
				{ q: 0, r: 0 },
				{ q: 2, r: -1 },
			],
			42,
			DEFAULT_TERRAIN_CONFIG
		)

		const tiles = unpackFieldResult(request, {
			stride: FIELD_RESULT_STRIDE,
			values: Float32Array.from([
				0.1, 0.2, 0.3, 0.4, 0.5,
				0.6, 0.7, 0.8, 0.9, 1.0,
			]),
		})

		expect(tiles.get('0,0')?.height).toBeCloseTo(0.1)
		expect(tiles.get('0,0')?.temperature).toBeCloseTo(0.2)
		expect(tiles.get('0,0')?.humidity).toBeCloseTo(0.3)
		expect(tiles.get('0,0')?.sediment).toBeCloseTo(0.4)
		expect(tiles.get('0,0')?.waterTable).toBeCloseTo(0.5)
		expect(tiles.get('2,-1')?.height).toBeCloseTo(0.6)
		expect(tiles.get('2,-1')?.temperature).toBeCloseTo(0.7)
		expect(tiles.get('2,-1')?.humidity).toBeCloseTo(0.8)
		expect(tiles.get('2,-1')?.sediment).toBeCloseTo(0.9)
		expect(tiles.get('2,-1')?.waterTable).toBeCloseTo(1.0)
	})

	it('exposes a shader body seam with the expected helpers and output writes', () => {
		const source = createFieldGenerationShaderSource()
		expect(source).toContain('fn perlin')
		expect(source).toContain('fn fbmSample')
		expect(source).toContain('values0[thread.x]')
		expect(source).toContain('values1[thread.x]')
	})

	it('webgpu capability probe is safe in test/node environments', () => {
		expect(typeof canUseWebGpuFields()).toBe('boolean')
	})

	it('keeps sync generation on cpu while async auto can choose gpu', () => {
		disposeGpuFieldRuntime()
		expect(resolveSyncFieldGenerationBackend('gpu')).toBe('cpu')
		expect(resolveAsyncFieldGenerationBackend('gpu')).toBe('gpu')
		expect(resolveAsyncFieldGenerationBackend('auto', AUTO_GPU_MIN_TILES - 1)).toBe('cpu')
		expect(resolveAsyncFieldGenerationBackend('auto', AUTO_GPU_MIN_TILES)).toBe('cpu')
	})

	it('matches CPU field generation for representative coords', async () => {
		const coords = [
			{ q: 0, r: 0 },
			{ q: 3, r: -2 },
			{ q: -4, r: 5 },
			{ q: 7, r: -1 },
		]
		const cpu = generateFieldsCpu(coords, 42, DEFAULT_TERRAIN_CONFIG)
		const gpu = await generateFieldsGpu(coords, 42, DEFAULT_TERRAIN_CONFIG)

		for (const coord of coords) {
			const key = `${coord.q},${coord.r}`
			expect(gpu.get(key)?.height).toBeCloseTo(cpu.get(key)?.height ?? 0, 5)
			expect(gpu.get(key)?.temperature).toBeCloseTo(cpu.get(key)?.temperature ?? 0, 5)
			expect(gpu.get(key)?.humidity).toBeCloseTo(cpu.get(key)?.humidity ?? 0, 5)
			expect(gpu.get(key)?.sediment).toBeCloseTo(cpu.get(key)?.sediment ?? 0, 5)
			expect(gpu.get(key)?.waterTable).toBeCloseTo(cpu.get(key)?.waterTable ?? 0, 5)
		}
	})

	it('can warm and dispose the gpu runtime explicitly', async () => {
		disposeGpuFieldRuntime()
		expect(isGpuFieldRuntimeReady()).toBe(false)
		expect(typeof (await warmGpuFieldRuntime())).toBe('boolean')
		if (canUseWebGpuFields()) {
			expect(isGpuFieldRuntimeReady()).toBe(true)
		}
		disposeGpuFieldRuntime()
		expect(isGpuFieldRuntimeReady()).toBe(false)
	})
})
