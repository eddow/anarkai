import { axial } from '../hex/axial'
import type { AxialCoord, AxialKey } from '../hex/types'
import { createPermutationTable } from '../noise'
import type { TerrainConfig, TileField } from '../types'
import { generateFieldsCpu, generateTileFieldCpu } from './cpu'
import createWebGpGpu, { f32, u32, vec2i, vec4f } from 'webgpgpu.ts'

export const FIELD_RESULT_STRIDE = 5
export const FIELD_SHADER_ENTRYPOINT = 'main'

export interface PackedFieldRequest {
	seed: number
	config: TerrainConfig
	coords: Int32Array
}

export interface PackedFieldResult {
	stride: number
	values: Float32Array
}

interface GpuFieldKernelInput {
	seed: number
	octaves: number
	persistence: number
	lacunarity: number
	scale: number
	temperatureScale: number
	humidityScale: number
	perm: Uint32Array
	coords: Int32Array[]
}

interface GpuFieldKernelResult {
	values0: ArrayLike<[number, number, number, number]>
	values1: ArrayLike<number>
}

interface GpuFieldRuntime {
	run(input: GpuFieldKernelInput): Promise<GpuFieldKernelResult>
	dispose(): void
}

let gpuFieldRuntimePromise: Promise<GpuFieldRuntime> | undefined
let gpuFieldRuntime: GpuFieldRuntime | undefined
const permutationTableCache = new Map<number, Uint32Array>()

/**
 * Browser-only capability probe. Kept separate from generation so the core package
 * stays usable in node/test environments without DOM lib requirements.
 */
export function canUseWebGpuFields(): boolean {
	const nav = (globalThis as { navigator?: { gpu?: unknown } }).navigator
	return typeof nav === 'object' && nav !== null && 'gpu' in nav
}

export function isGpuFieldRuntimeReady(): boolean {
	return gpuFieldRuntime !== undefined
}

export function packFieldRequest(
	coords: Iterable<AxialCoord>,
	seed: number,
	config: TerrainConfig
): PackedFieldRequest {
	const packed: number[] = []
	for (const coord of coords) {
		packed.push(coord.q, coord.r)
	}
	return {
		seed,
		config,
		coords: Int32Array.from(packed),
	}
}

export function unpackFieldResult(
	request: PackedFieldRequest,
	result: PackedFieldResult
): Map<AxialKey, TileField> {
	if (result.stride !== FIELD_RESULT_STRIDE) {
		throw new Error(`Invalid GPU field result stride: expected ${FIELD_RESULT_STRIDE}, got ${result.stride}`)
	}
	const expected = (request.coords.length / 2) * result.stride
	if (result.values.length !== expected) {
		throw new Error(`Invalid GPU field result length: expected ${expected}, got ${result.values.length}`)
	}

	const tiles = new Map<AxialKey, TileField>()
	for (let coordIndex = 0, valueIndex = 0; coordIndex < request.coords.length; coordIndex += 2) {
		const coord = {
			q: request.coords[coordIndex]!,
			r: request.coords[coordIndex + 1]!,
		}
		tiles.set(axial.key(coord), {
			height: result.values[valueIndex]!,
			temperature: result.values[valueIndex + 1]!,
			humidity: result.values[valueIndex + 2]!,
			sediment: result.values[valueIndex + 3]!,
			waterTable: result.values[valueIndex + 4]!,
		})
		valueIndex += result.stride
	}
	return tiles
}

export async function generateTileFieldGpu(
	seed: number,
	coord: AxialCoord,
	config: TerrainConfig
): Promise<TileField> {
	const tiles = await generateFieldsGpu([coord], seed, config)
	return tiles.get(axial.key(coord)) ?? generateTileFieldCpu(seed, coord, config)
}

export async function generateFieldsGpu(
	coords: Iterable<AxialCoord>,
	seed: number,
	config: TerrainConfig
): Promise<Map<AxialKey, TileField>> {
	const request = packFieldRequest(coords, seed, config)
	if (request.coords.length === 0) return new Map()

	try {
		const runtime = await getGpuFieldRuntime()
		const { values0, values1 } = await runtime.run({
			seed: seed >>> 0,
			octaves: config.octaves >>> 0,
			persistence: config.persistence,
			lacunarity: config.lacunarity,
			scale: config.scale,
			temperatureScale: config.temperatureScale,
			humidityScale: config.humidityScale,
			perm: getPermutationTable(seed),
			coords: unpackVec2i(request.coords),
		})
		return unpackFieldResult(request, {
			stride: FIELD_RESULT_STRIDE,
			values: flattenKernelResult(values0, values1),
		})
	} catch {
		return generateFieldsCpu(unpackCoords(request.coords), seed, config)
	}
}

export async function warmGpuFieldRuntime(): Promise<boolean> {
	try {
		await getGpuFieldRuntime()
		return true
	} catch {
		disposeGpuFieldRuntime()
		return false
	}
}

export function disposeGpuFieldRuntime(): void {
	gpuFieldRuntime?.dispose()
	gpuFieldRuntime = undefined
	gpuFieldRuntimePromise = undefined
}

function getPermutationTable(seed: number): Uint32Array {
	const cached = permutationTableCache.get(seed)
	if (cached) return cached
	const created = createPermutationTable(seed)
	permutationTableCache.set(seed, created)
	return created
}

function unpackCoords(coords: Int32Array): AxialCoord[] {
	const unpacked: AxialCoord[] = []
	for (let index = 0; index < coords.length; index += 2) {
		unpacked.push({ q: coords[index]!, r: coords[index + 1]! })
	}
	return unpacked
}

function unpackVec2i(coords: Int32Array): Int32Array[] {
	const unpacked: Int32Array[] = []
	for (let index = 0; index < coords.length; index += 2) {
		unpacked.push(Int32Array.from([coords[index]!, coords[index + 1]!]))
	}
	return unpacked
}

function flattenKernelResult(
	values0: ArrayLike<[number, number, number, number]>,
	values1: ArrayLike<number>
): Float32Array {
	const flat = new Float32Array(values0.length * FIELD_RESULT_STRIDE)
	for (let index = 0; index < values0.length; index++) {
		const base = index * FIELD_RESULT_STRIDE
		const value0 = values0[index]!
		flat[base] = value0[0]
		flat[base + 1] = value0[1]
		flat[base + 2] = value0[2]
		flat[base + 3] = value0[3]
		flat[base + 4] = values1[index]!
	}
	return flat
}

async function getGpuFieldRuntime(): Promise<GpuFieldRuntime> {
	if (!gpuFieldRuntimePromise) {
		gpuFieldRuntimePromise = createGpuFieldRuntime().then((runtime) => {
			gpuFieldRuntime = runtime
			return runtime
		})
	}
	return gpuFieldRuntimePromise
}

async function createGpuFieldRuntime(): Promise<GpuFieldRuntime> {
	const webGpGpu = await createWebGpGpu()
	const kernel = webGpGpu
		.input({
			seed: u32,
			octaves: u32,
			persistence: f32,
			lacunarity: f32,
			scale: f32,
			temperatureScale: f32,
			humidityScale: f32,
			perm: u32.array(512),
			coords: vec2i.array('threads.x'),
		})
		.output({
			values0: vec4f.array('threads.x'),
			values1: f32.array('threads.x'),
		})
		.kernel(createFieldGenerationShaderSource())

	return {
		run(input) {
			return kernel(input)
		},
		dispose() {
			webGpGpu.dispose()
		},
	}
}

/**
 * WGSL kernel content for the WebGpGpu field backend.
 * The library injects the final entrypoint and thread guards for us; we only
 * provide helpers and the body that computes one tile at `thread.x`.
 */
export function createFieldGenerationShaderSource(): string {
	return /* wgsl */ `
fn fade(t: f32) -> f32 {
	return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

fn lerp1(t: f32, a: f32, b: f32) -> f32 {
	return a + t * (b - a);
}

fn grad(hash: u32, x: f32, y: f32) -> f32 {
	let h = hash & 15u;
	let u = select(y, x, h < 8u);
	var v = 0.0;
	if (h < 4u) {
		v = y;
	} else if (h == 12u || h == 14u) {
		v = x;
	}
	let gu = select(-u, u, (h & 1u) == 0u);
	let gv = select(-v, v, (h & 2u) == 0u);
	return gu + gv;
}

fn perlin(sampleX: f32, sampleY: f32) -> f32 {
	var x = sampleX;
	var y = sampleY;
	let floorX = floor(x);
	let floorY = floor(y);
	let X = u32(i32(floorX) & 255);
	let Y = u32(i32(floorY) & 255);
	x = x - floorX;
	y = y - floorY;

	let u = fade(x);
	let v = fade(y);

	let A = perm[X] + Y;
	let AA = perm[A];
	let AB = perm[A + 1u];
	let B = perm[X + 1u] + Y;
	let BA = perm[B];
	let BB = perm[B + 1u];

	return lerp1(
		v,
		lerp1(u, grad(perm[AA], x, y), grad(perm[BA], x - 1.0, y)),
		lerp1(u, grad(perm[AB], x, y - 1.0), grad(perm[BB], x - 1.0, y - 1.0))
	);
}

fn fbmSample(sampleX: f32, sampleY: f32, octs: u32, persistenceV: f32, lacunarityV: f32) -> f32 {
	var value = 0.0;
	var amplitude = 1.0;
	var frequency = 1.0;
	var maxValue = 0.0;

	for (var octave = 0u; octave < octs; octave++) {
		value += perlin(sampleX * frequency, sampleY * frequency) * amplitude;
		maxValue += amplitude;
		amplitude *= persistenceV;
		frequency *= lacunarityV;
	}

	return value / maxValue;
}

let coord = coords[thread.x];
let q = f32(coord.x);
let r = f32(coord.y);
let wx = q * 0.866;
let wy = r + q * 0.5;

let cos1 = 0.8660254037844386;
let sin1 = 0.5;
let cos2 = 0.8660254037844386;
let sin2 = -0.5;

let x1 = wx * cos1 - wy * sin1;
let y1 = wx * sin1 + wy * cos1;
let x2 = wx * cos2 - wy * sin2;
let y2 = wx * sin2 + wy * cos2;

let h0 = fbmSample(wx * scale, wy * scale, octaves, persistence, lacunarity);
let h1 = fbmSample(x1 * scale, y1 * scale, octaves, persistence, lacunarity);
let h2 = fbmSample(x2 * scale, y2 * scale, octaves, persistence, lacunarity);

let height = (h0 + h1 + h2) / 3.0;
let temperature = fbmSample(
	(wx * 0.9 + y1 * 0.1) * temperatureScale,
	(wy * 0.9 + x2 * 0.1) * temperatureScale,
	3u,
	0.5,
	2.0
);
let humidity = fbmSample(
	(wx * 0.85 + x1 * 0.15) * humidityScale,
	(wy * 0.85 + y2 * 0.15) * humidityScale,
	3u,
	0.5,
	2.0
);

values0[thread.x] = vec4<f32>(height, temperature, humidity, 0.0);
values1[thread.x] = 0.0;
`
}
