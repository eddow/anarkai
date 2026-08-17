/**
 * Iterable collection helpers that iterate the source directly with `for…of`,
 * avoiding the intermediate array that `[...set].filter/map/find/some` materializes.
 *
 * Ergonomics mirror `Array.prototype`: the source may be `null`/`undefined`
 * (treated as empty), which lets callers drop the `?? []` guard.
 */

/** Entries of `source` that satisfy `predicate` — equivalent to `[...source].filter(predicate)`. */
export function filterSet<T>(
	source: Iterable<T> | null | undefined,
	predicate: (value: T) => boolean
): T[] {
	if (!source) return []
	const out: T[] = []
	for (const value of source) if (predicate(value)) out.push(value)
	return out
}

/** Map `source` through `project` — equivalent to `[...source].map(project)`. */
export function mapSet<T, U>(
	source: Iterable<T> | null | undefined,
	project: (value: T) => U
): U[] {
	if (!source) return []
	const out: U[] = []
	for (const value of source) out.push(project(value))
	return out
}

/** First entry of `source` satisfying `predicate`, else `undefined` — equivalent to `[...source].find(predicate)`. */
export function findInSet<T>(
	source: Iterable<T> | null | undefined,
	predicate: (value: T) => boolean
): T | undefined {
	if (!source) return undefined
	for (const value of source) if (predicate(value)) return value
	return undefined
}

/** True when any entry of `source` satisfies `predicate` — equivalent to `[...source].some(predicate)`. */
export function someInSet<T>(
	source: Iterable<T> | null | undefined,
	predicate: (value: T) => boolean
): boolean {
	if (!source) return false
	for (const value of source) if (predicate(value)) return true
	return false
}
