/**
 * Normalizes legacy `slotted-storage` / `specific-storage` and unified `storage` / `road-fret` actions.
 */

export function isAlveolusStorageAction(action: Ssh.Action): action is Ssh.AlveolusStorageAction {
	const t = action.type
	return t === 'slotted-storage' || t === 'specific-storage' || t === 'storage' || t === 'road-fret'
}

export function usesSlottedStorageLayout(action: Ssh.AlveolusStorageAction): boolean {
	if (action.type === 'slotted-storage') return true
	if (action.type === 'storage' || action.type === 'road-fret') return action.kind === 'slotted'
	return false
}

export function usesSpecificStorageLayout(action: Ssh.AlveolusStorageAction): boolean {
	if (action.type === 'specific-storage') return true
	if (action.type === 'storage' || action.type === 'road-fret') return action.kind === 'specific'
	return false
}

export function isRoadFretAction(action: Ssh.Action): action is Ssh.RoadFretAction {
	return action.type === 'road-fret'
}

export function readSlottedStorageParams(
	action: Ssh.AlveolusStorageAction
): { slots: number; capacity: number; buffers?: Record<string, number> } {
	if (action.type === 'slotted-storage') {
		return { slots: action.slots, capacity: action.capacity, buffers: action.buffers }
	}
	if ((action.type === 'storage' || action.type === 'road-fret') && action.kind === 'slotted') {
		return { slots: action.slots, capacity: action.capacity, buffers: action.buffers }
	}
	throw new Error(`Expected slotted storage layout, got action type ${(action as Ssh.Action).type}`)
}

export function readSpecificStorageParams(action: Ssh.AlveolusStorageAction): {
	goods: Ssh.SpecificStorage
	buffers?: Record<string, number>
} {
	if (action.type === 'specific-storage') {
		return { goods: action.goods, buffers: action.buffers }
	}
	if ((action.type === 'storage' || action.type === 'road-fret') && action.kind === 'specific') {
		return { goods: action.goods, buffers: action.buffers }
	}
	throw new Error(`Expected specific storage layout, got action type ${(action as Ssh.Action).type}`)
}
