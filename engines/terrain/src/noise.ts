/**
 * Seeded Perlin noise + fractal Brownian motion.
 * Uses Rust/WASM implementation — no CPU fallback.
 */

import { isTerrainProfileEnabled, logTerrainProfile } from './profile'
import { ensureWasmLoaded, getWasmModule } from './wasm-loader'

// ============================================================================
// Profiling — logs to console after terrain generation completes
// ============================================================================

interface ProfileEntry {
	count: number
	totalMs: number
	minMs: number
	maxMs: number
}

const profile = new Map<string, ProfileEntry>()

function nowMs(): number {
	try {
		return (globalThis as any).performance?.now() ?? Date.now()
	} catch {
		return Date.now()
	}
}

export function profileCall(name: string, fn: () => number): number {
	const t0 = nowMs()
	const result = fn()
	const elapsed = nowMs() - t0
	let entry = profile.get(name)
	if (!entry) {
		entry = { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0 }
		profile.set(name, entry)
	}
	entry.count++
	entry.totalMs += elapsed
	if (elapsed < entry.minMs) entry.minMs = elapsed
	if (elapsed > entry.maxMs) entry.maxMs = elapsed
	return result
}

/** Print accumulated profile stats to console. Call after generation. */
export function dumpNoiseProfile(): void {
	if (!isTerrainProfileEnabled()) {
		profile.clear()
		return
	}
	if (profile.size === 0) return
	const lines = ['[wasm:profile] Noise call statistics']
	for (const [name, entry] of [...profile.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs)) {
		const avgUs = ((entry.totalMs / entry.count) * 1000).toFixed(1)
		lines.push(
			`  ${name}: ${entry.count} calls, ${entry.totalMs.toFixed(1)}ms total, ${avgUs}µs avg, ${(entry.minMs * 1000).toFixed(1)}-${(entry.maxMs * 1000).toFixed(1)}µs range`
		)
	}
	logTerrainProfile(lines.join('\n'))
}

/** Reset profile counters for next generation. */
export function resetNoiseProfile(): void {
	profile.clear()
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Check if WASM noise is available
 */
export function isWasmNoiseAvailable(): boolean {
	try {
		return getWasmModule() !== null
	} catch {
		return false
	}
}

/**
 * Initialize the WASM module for noise functions.
 * Call this at app startup to ensure WASM is loaded before terrain generation.
 */
export async function initWasmNoise(): Promise<void> {
	await ensureWasmLoaded()
}

/**
 * Seeded Perlin noise class.
 * Creates a persistent WasmPerlinNoise on WASM heap for optimal performance.
 */
export class PerlinNoise {
	private readonly seed: number

	constructor(seed: number = 0) {
		this.seed = seed
	}

	noise(x: number, y: number): number {
		return profileCall('wasm_perlin_sample', () => {
			const wasm = getWasmModule()
			return wasm.wasm_perlin_sample(BigInt(this.seed), x, y)
		})
	}
}

/**
 * Fractal Brownian motion.
 */
export function fbm(
	noise: PerlinNoise,
	x: number,
	y: number,
	octaves: number,
	persistence: number,
	lacunarity: number
): number {
	return profileCall('wasm_fbm_sample', () => {
		const wasm = getWasmModule()
		return wasm.wasm_fbm_sample(BigInt(noise['seed']), x, y, octaves, persistence, lacunarity)
	})
}

/**
 * Create a noise object tied to a seed.
 */
export function createNoise(seed: number): PerlinNoise {
	return new PerlinNoise(seed)
}

/**
 * Domain warping for organic shapes.
 */
export function domainWarp(
	seed: number,
	x: number,
	y: number,
	octaves: number,
	persistence: number,
	lacunarity: number
): number {
	const wasm = getWasmModule()
	return profileCall('domainWarp', () =>
		wasm.wasm_domain_warp(BigInt(seed), x, y, octaves, persistence, lacunarity)
	)
}

// ============================================================================
// CPU Fallback Implementation (preserved for backward compatibility)
// ============================================================================

export function createPermutationTable(seed: number): Uint32Array {
	const perm: number[] = []
	for (let i = 0; i < 256; i++) perm[i] = i

	const rng = seededRandom(seed)
	for (let i = 255; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1))
		;[perm[i], perm[j]] = [perm[j], perm[i]]
	}

	return Uint32Array.from([...perm, ...perm])
}

export class CpuPerlinNoise {
	private readonly p: number[]

	constructor(seed: number = 0) {
		this.p = [...createPermutationTable(seed)]
	}

	noise(x: number, y: number): number {
		const X = Math.floor(x) & 255
		const Y = Math.floor(y) & 255
		x -= Math.floor(x)
		y -= Math.floor(y)

		const u = fade(x)
		const v = fade(y)

		const A = this.p[X] + Y
		const AA = this.p[A]
		const AB = this.p[A + 1]
		const B = this.p[X + 1] + Y
		const BA = this.p[B]
		const BB = this.p[B + 1]

		return lerp(
			v,
			lerp(u, grad(this.p[AA], x, y), grad(this.p[BA], x - 1, y)),
			lerp(u, grad(this.p[AB], x, y - 1), grad(this.p[BB], x - 1, y - 1))
		)
	}
}

function seededRandom(seed: number): () => number {
	let state = seed
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296
		return state / 4294967296
	}
}

function fade(t: number): number {
	return t * t * t * (t * (t * 6 - 15) + 10)
}

function lerp(t: number, a: number, b: number): number {
	return a + t * (b - a)
}

function grad(hash: number, x: number, y: number): number {
	const h = hash & 15
	const u = h < 8 ? x : y
	const v = h < 4 ? y : h === 12 || h === 14 ? x : 0
	return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
}
