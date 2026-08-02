import { unwrap } from 'mutts'

let debugObjectIds = new WeakMap<object, string>()
let nextDebugObjectId = 1

function objectIdFor(value: object): string {
	let id = debugObjectIds.get(value)
	if (!id) {
		id = `obj:${nextDebugObjectId++}`
		debugObjectIds.set(value, id)
	}
	return id
}

export function debugObjectId(value: unknown): string | undefined {
	if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined
	// ReactiveBase methods run with the raw target as `this` while callers hold the proxy.
	// Always key by the unwrapped object so both sides share one stable debug id.
	const raw = unwrap(value)
	return objectIdFor(
		raw && (typeof raw === 'object' || typeof raw === 'function') ? raw : value
	)
}

export function debugRawObjectId(value: unknown): string | undefined {
	return debugObjectId(value)
}

export function resetDebugObjectIds(): void {
	debugObjectIds = new WeakMap()
	nextDebugObjectId = 1
}
