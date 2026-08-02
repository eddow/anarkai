import { objectToProxy, unwrap } from 'mutts'

/**
 * True when both values refer to the same underlying object, even if one side is
 * a mutts reactive proxy and the other is the raw target (`this` inside @reactive methods).
 */
export function sameRef(a: unknown, b: unknown): boolean {
	if (a === b) return true
	if (!a || !b) return false
	if (typeof a !== 'object' && typeof a !== 'function') return false
	if (typeof b !== 'object' && typeof b !== 'function') return false
	return unwrap(a) === unwrap(b)
}

/**
 * Prefer the public reactive proxy for a `@reactive` instance when one exists.
 * Methods on ReactiveBase run with the raw target as `this`; external code holds the proxy.
 */
export function publicRef<T extends object>(value: T): T {
	const raw = unwrap(value) as T
	if (!raw || (typeof raw !== 'object' && typeof raw !== 'function')) return value
	const proxy = objectToProxy.get(raw as object)
	return (proxy as T | undefined) ?? value
}
