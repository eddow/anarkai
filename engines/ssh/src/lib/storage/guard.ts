// GC-aware leak guard for allocation tokens
// Uses FinalizationRegistry to detect when an allocation token is garbage-collected
// without being fulfilled/cancelled, and logs the provided reason.

type Held = { reason: any; allocation: object }

const registry: FinalizationRegistry<Held> | null =
	typeof FinalizationRegistry !== 'undefined'
		? new FinalizationRegistry<Held>(({ reason, allocation }) => {
				try {
					// Surface the programming error clearly
					console.error('Leaked allocation (not fulfilled/cancelled):', reason, allocation)
				} catch {}
			})
		: null

// Track unregister tokens per allocation object
const tokens = new WeakMap<object, object>()

// Track invalidated allocations (fulfilled or cancelled)
const invalidatedAllocations = new WeakSet<object>()

export function guardAllocation<Allocation extends object>(allocation: Allocation, reason: any) {
	if (!registry) return
	const token = {}
	tokens.set(allocation, token)
	//console.trace('allocate', allocation, reason)
	registry.register(allocation, { reason, allocation: { ...allocation } }, token)
}

export function allocationEnded<Allocation extends object>(allocation: Allocation) {
	if (!registry) return
	const token = tokens.get(allocation)
	if (!token) return
	//console.trace('free', allocation)
	registry.unregister(token)
	tokens.delete(allocation)
}

export function invalidateAllocation<Allocation extends object>(allocation: Allocation) {
	invalidatedAllocations.add(allocation)
}

export function isAllocationValid<Allocation extends object>(allocation: Allocation): boolean {
	return !invalidatedAllocations.has(allocation)
}

export class AllocationError extends Error {
	constructor(
		message: string,
		public readonly reason: any,
	) {
		super(message)
		this.name = 'AllocationError'
	}
}
