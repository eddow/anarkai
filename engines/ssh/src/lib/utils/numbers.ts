function stringToHash(str: string): number {
	let hash = 0
	for (let i = 0; i < str.length; i++) {
		// Convert character to its ASCII code and add it to the hash
		hash = (hash << 5) - hash + str.charCodeAt(i)
		// Convert to 32bit integer
		hash |= 0
	}
	return hash * Math.PI
}

function numeric(seed: number | string): number {
	return typeof seed === 'string' ? stringToHash(seed) : seed * Math.PI
}

export type RandGenerator = (max?: number, min?: number) => number
/**
 * Linear Congruential Generator
 */
const [a, c, m] = [1664525, 1013904223, 2 ** 32]
export function LCG(...seeds: (number | string)[]): RandGenerator {
	if (!seeds.length) throw new Error('LCG requires at least one seed for reproducibility')
	let state = Math.abs(seeds.reduce<number>((acc, seed) => acc ^ (numeric(seed) * c), 0))
	return (max = 1, min = 0) => {
		state = (a * state + c + m) % m
		return (state / m) * (max - min) + min
	}
}

/**
 * Returns an array of numbers between min and maxP (without maxP)
 */
export function numbers(maxP: number, min = 0, step = 1) {
	const arr = []
	for (let i = min; i < maxP; i += step) arr.push(i)
	return arr
}

export function subSeed(...seeds: (number | string)[]) {
	return seeds.reduce<number>((acc, seed) => acc ^ (numeric(seed) * c), 0)
}

export function uuid(rnd: RandGenerator) {
	// Generate a proper UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
	// where x is any hexadecimal digit and y is one of 8, 9, A, or B

	// Generate 32 random hex digits
	const hex = '0123456789abcdef'
	let result = ''

	// Generate 8 hex digits
	for (let i = 0; i < 8; i++) {
		result += hex[Math.floor(rnd(16))]
	}
	result += '-'

	// Generate 4 hex digits
	for (let i = 0; i < 4; i++) {
		result += hex[Math.floor(rnd(16))]
	}
	result += '-'

	// Version 4 identifier (4xxx)
	result += '4'
	for (let i = 0; i < 3; i++) {
		result += hex[Math.floor(rnd(16))]
	}
	result += '-'

	// Variant identifier (yxxx where y is 8, 9, A, or B)
	const variantChars = ['8', '9', 'a', 'b']
	result += variantChars[Math.floor(rnd(4))]
	for (let i = 0; i < 3; i++) {
		result += hex[Math.floor(rnd(16))]
	}
	result += '-'

	// Generate remaining 12 hex digits
	for (let i = 0; i < 12; i++) {
		result += hex[Math.floor(rnd(16))]
	}

	return result
}
