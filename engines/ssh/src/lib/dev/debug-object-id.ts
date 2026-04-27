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
	return objectIdFor(value)
}

export function debugRawObjectId(value: unknown): string | undefined {
	if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined
	const raw = unwrap(value)
	return raw && (typeof raw === 'object' || typeof raw === 'function')
		? objectIdFor(raw)
		: undefined
}

export function resetDebugObjectIds(): void {
	debugObjectIds = new WeakMap()
	nextDebugObjectId = 1
}
