/** Deterministic PRNG for hydrology (per coord, seeded). */
export function riverRng(seed: number, q: number, r: number): () => number {
	let state = riverSeed(seed, q, r)
	return () => {
		state = (Math.imul(1664525, state) + 1013904223) >>> 0
		return state / 4294967296
	}
}

function riverSeed(seed: number, q: number, r: number): number {
	const x = seed ^ Math.imul(q, 374761393) ^ Math.imul(r, 668265263)
	return x >>> 0 || 1
}
