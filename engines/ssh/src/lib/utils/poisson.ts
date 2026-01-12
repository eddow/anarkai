/**
 * Poisson random number generation utilities
 * Implements Knuth's algorithm for generating Poisson-distributed random numbers
 */

/**
 * Generate a random number from a Poisson distribution with mean lambda
 * Uses Knuth's algorithm for efficiency
 */
export function poissonRandom(
	lambda: number,
	rnd: (max?: number, min?: number) => number = Math.random,
): number {
	if (lambda <= 0) return 0
	if (lambda > 100) {
		// For large lambda, use normal approximation
		return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * (rnd() * 2 - 1)))
	}

	let k = 0
	let p = 1
	const L = Math.exp(-lambda)

	do {
		k++
		p *= rnd()
	} while (p >= L && k < 1000) // Cap to avoid infinite loops

	return k - 1
}

/**
 * Precomputed Poisson lookup table for common lambda values
 * Improves performance when generating many Poisson random numbers
 */
class PoissonLookupTable {
	private table: Map<string, number[]> = new Map()
	private maxK = 20
	private lambdaStep = 0.1
	private maxLambda = 5.0

	constructor() {
		this.buildTable()
	}

	private buildTable(): void {
		for (let lambda = 0.1; lambda <= this.maxLambda; lambda += this.lambdaStep) {
			const probabilities: number[] = []
			let cumulativeP = 0

			for (let k = 0; k <= this.maxK; k++) {
				const p = this.poissonProbability(lambda, k)
				cumulativeP += p
				probabilities.push(cumulativeP)
			}

			this.table.set(lambda.toFixed(1), probabilities)
		}
	}

	private poissonProbability(lambda: number, k: number): number {
		return (Math.exp(-lambda) * lambda ** k) / this.factorial(k)
	}

	private factorial(n: number): number {
		if (n <= 1) return 1
		let result = 1
		for (let i = 2; i <= n; i++) {
			result *= i
		}
		return result
	}

	/**
	 * Get a Poisson random number using the lookup table
	 * Falls back to direct calculation for values not in table
	 */
	get(lambda: number, rnd: (max?: number, min?: number) => number = Math.random): number {
		if (lambda <= 0) return 0

		// For very small lambda, use simple approximation
		if (lambda < 0.1) {
			return rnd() < lambda ? 1 : 0
		}

		// For very large lambda, use normal approximation
		if (lambda > this.maxLambda) {
			return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * (rnd() * 2 - 1)))
		}

		// Use lookup table
		const key = lambda.toFixed(1)
		const probabilities = this.table.get(key)

		if (probabilities) {
			const r = rnd()
			for (let k = 0; k < probabilities.length; k++) {
				if (r < probabilities[k]) return k
			}
			return probabilities.length
		}

		// Fallback to direct calculation
		return poissonRandom(lambda, rnd)
	}
}

// Singleton instance for performance
const poissonTable = new PoissonLookupTable()

/**
 * High-performance Poisson random number generator
 * Uses lookup table for common values, direct calculation for edge cases
 */
export function fastPoissonRandom(
	lambda: number,
	rnd: (max?: number, min?: number) => number = Math.random,
): number {
	return poissonTable.get(lambda, rnd)
}
