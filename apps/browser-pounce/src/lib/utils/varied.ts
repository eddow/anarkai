export const tileSize = 30
export const epsilon = 1e-6

export function objectMap<T extends Record<string, any>, R extends { [k in keyof T]: any }>(
	obj: T,
	fn: <K extends keyof T>(value: T[K], key: K) => R[K],
): Partial<R> {
	return Object.fromEntries(
		Object.entries(obj).map(([key, value]) => [key, fn(value, key)] as [keyof R, R[keyof R]]) as [
			keyof R,
			R[keyof R],
		][],
	) as Partial<R>
}

type ElementTypes<T extends readonly unknown[]> = {
	[K in keyof T]: T[K] extends readonly (infer U)[] ? U : T[K]
}

export function zip<T extends (readonly unknown[])[]>(...args: T): ElementTypes<T>[] {
	if (!args.length) return []
	const minLength = Math.min(...args.map((arr) => arr.length))
	const result: ElementTypes<T>[] = []

	for (let i = 0; i < minLength; i++) {
		const tuple = args.map((arr) => arr[i]) as ElementTypes<T>
		result.push(tuple)
	}

	return result
}

export function isInteger(value: number): boolean {
	return value - Math.floor(value) < epsilon
}

export function lowerFirst(str: string): string {
	if (!str) return str
	return str.charAt(0).toLowerCase() + str.slice(1)
}

export function upperFirst(str: string): string {
	if (!str) return str
	return str.charAt(0).toUpperCase() + str.slice(1)
}

class CaseFormatter {
	private terms: string[]
	constructor(name: string) {
		const spaced = name
			.replace(/[_-]+/g, ' ')
			.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
			.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
			.trim()
		this.terms = spaced ? spaced.split(/\s+/) : []
	}
	transform(fn: (terms: string[]) => string[] | void): this {
		this.terms = fn(this.terms) ?? this.terms
		return this
	}
	get camel() {
		return this.terms
			.map((term, index) => (index === 0 ? lowerFirst(term) : upperFirst(term)))
			.join('')
	}
	get snake() {
		return lowerFirst(this.terms.join('_'))
	}
	get kebab() {
		return lowerFirst(this.terms.map(lowerFirst).join('-'))
	}
	get pascal() {
		return this.terms.map((term) => upperFirst(term)).join('')
	}
}
export function casing(name: string) {
	return new CaseFormatter(name)
}

export function maxBy<T>(array: T[], fn: (item: T) => number | undefined): T | undefined {
	let maxVal = Number.NEGATIVE_INFINITY
	let maxItem: T | undefined
	for (const item of array) {
		const val = fn(item)
		if (val !== undefined && val > maxVal) {
			maxVal = val
			maxItem = item
		}
	}
	return maxItem
}

export function setPop<T>(set: Set<T>): T | undefined {
	if (!set.size) return undefined
	const value = set.values().next().value!
	set.delete(value)
	return value
}
