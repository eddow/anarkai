/**
 * Opaque runtime identity for a tracked convey movement.
 * Stable across object replacement (e.g. hive topology rebind) when preserved on snapshots.
 */
export type MovementRef = {
	readonly id: number
}

let nextMovementRefId = 1

export function createMovementRef(): MovementRef {
	return { id: nextMovementRefId++ }
}

const refIds = new WeakMap<object, number>()
let nextRefId = 1

/** Small stable number for logs (not a serialization id). */
export function movementRefId(ref: MovementRef): number {
	if (typeof ref.id === 'number') return ref.id
	let id = refIds.get(ref)
	if (id === undefined) {
		id = nextRefId++
		refIds.set(ref, id)
	}
	return id
}
