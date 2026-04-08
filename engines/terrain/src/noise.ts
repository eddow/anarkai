/**
 * Seeded Perlin noise + fractal Brownian motion (CPU fallback).
 * Ported from engines/ssh/src/lib/generation/perlin-terrain.ts — standalone, no ssh deps.
 */

export class PerlinNoise {
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

export function fbm(
	noise: PerlinNoise,
	x: number,
	y: number,
	octaves: number,
	persistence: number,
	lacunarity: number
): number {
	let value = 0
	let amplitude = 1
	let frequency = 1
	let maxValue = 0

	for (let i = 0; i < octaves; i++) {
		value += noise.noise(x * frequency, y * frequency) * amplitude
		maxValue += amplitude
		amplitude *= persistence
		frequency *= lacunarity
	}

	return value / maxValue
}

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
