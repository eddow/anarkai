import { traces } from '../dev/debug.ts'

// GC-aware leak guard for allocation tokens
// Uses FinalizationRegistry to detect when an allocation token is garbage-collected
// without being fulfilled/cancelled, and logs the provided reason.

type Held = { reason: any; allocation: object; createdAt: number; id: string; stack?: string }

// Global allocation counter for unique IDs
let allocationCounter = 0

const registry: FinalizationRegistry<Held> | null =
	typeof FinalizationRegistry !== 'undefined'
		? new FinalizationRegistry<Held>(({ reason, allocation, createdAt, id, stack }) => {
				try {
					// Surface the programming error clearly
					const duration = Date.now() - createdAt
					const errorInfo = {
						id,
						reason,
						allocation,
						createdAt: new Date(createdAt).toISOString(),
						duration: `${duration}ms`,
						stack,
					}
					console.error('Leaked allocation (not fulfilled/cancelled):', errorInfo)
					traces.allocations.error?.('Leaked allocation detected:', errorInfo)
				} catch {}
			})
		: null

// Track unregister tokens per allocation object. Some callers hold reactive proxies while
// constructors and internal methods may see the raw instance, so register both identities.
const tokens = new WeakMap<object, object>()
const activeAllocations = new Map<object, Held>()
const activeLiveAllocations = new Map<object, object>()

export function debugActiveAllocations(): Held[] {
	return [...activeAllocations.values()]
}

export function findLiveAllocations(
	predicate: (held: Held) => boolean
): Array<{ held: Held; allocation: object }> {
	const matches: Array<{ held: Held; allocation: object }> = []
	for (const [token, held] of activeAllocations.entries()) {
		if (!predicate(held)) continue
		const allocation = activeLiveAllocations.get(token)
		if (!allocation) continue
		matches.push({ held, allocation })
	}
	return matches
}

export function isAllocationValid(allocation: { ended?: unknown } | undefined): boolean {
	return allocation !== undefined && (allocation.ended === undefined || allocation.ended === false)
}

export function trackAllocation(allocation: object, reason: unknown): void {
	const existingToken = tokens.get(allocation)
	if (existingToken) {
		activeAllocations.set(existingToken, {
			reason,
			allocation,
			createdAt: Date.now(),
			id: String(++allocationCounter),
			stack: new Error().stack,
		})
		activeLiveAllocations.set(existingToken, allocation)
		return
	}
	const token = {}
	tokens.set(allocation, token)
	activeAllocations.set(token, {
		reason,
		allocation,
		createdAt: Date.now(),
		id: String(++allocationCounter),
		stack: new Error().stack,
	})
	activeLiveAllocations.set(token, allocation)
	registry?.register(allocation, activeAllocations.get(token)!, token)
}

export function untrackAllocation(allocation: object): void {
	const token = tokens.get(allocation)
	if (!token) return
	registry?.unregister(token)
	activeAllocations.delete(token)
	activeLiveAllocations.delete(token)
	tokens.delete(allocation)
}

export function getAllocationStats(): { total: number; byType: Record<string, number> } {
	const stats = { total: activeAllocations.size, byType: {} as Record<string, number> }
	for (const held of activeAllocations.values()) {
		const type = held.reason?.type || 'unknown'
		stats.byType[type] = (stats.byType[type] || 0) + 1
	}
	return stats
}

export function resetDebugActiveAllocations(): void {
	activeAllocations.clear()
	activeLiveAllocations.clear()
}

export class AllocationError extends Error {
	readonly reason: unknown

	constructor(message: string, reason: unknown) {
		super(message)
		this.name = 'AllocationError'
		Object.defineProperty(this, 'reason', {
			value: reason,
			enumerable: false,
			configurable: true,
		})
	}
}
