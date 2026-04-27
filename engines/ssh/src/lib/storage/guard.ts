import { unwrap } from 'mutts'
import { traces } from '../dev/debug.ts'

// GC-aware leak guard for allocation tokens
// Uses FinalizationRegistry to detect when an allocation token is garbage-collected
// without being fulfilled/cancelled, and logs the provided reason.

type Held = { reason: any; allocation: object; createdAt: number; id: string; stack?: string }
type InvalidationInfo = {
	label: string
	at: number
	stack?: string
}

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

// Track invalidated allocations (fulfilled or cancelled)
const invalidatedAllocations = new WeakSet<object>()
const invalidationInfos = new WeakMap<object, InvalidationInfo>()

function allocationVariants<Allocation extends object>(allocation: Allocation): object[] {
	const direct = allocation as object
	const unwrapped = unwrap(allocation) as object
	return direct === unwrapped ? [direct] : [direct, unwrapped]
}

export function guardAllocation<Allocation extends object>(allocation: Allocation, reason: any) {
	if (!registry) return
	const variants = allocationVariants(allocation)
	const token = {}
	for (const target of variants) tokens.set(target, token)

	// Enhanced allocation info for debugging
	const allocationInfo = {
		id: `alloc-${allocationCounter++}`,
		reason,
		allocation: { ...allocation },
		createdAt: Date.now(),
		stack: new Error().stack,
	}

	activeAllocations.set(token, allocationInfo)
	activeLiveAllocations.set(token, variants[0])
	traces.allocations.groupCollapsed?.('Allocation created:', allocationInfo)
	traces.allocations.trace?.()
	traces.allocations.groupEnd?.()
	registry.register(variants[0], allocationInfo, token)
}

export function allocationEnded<Allocation extends object>(allocation: Allocation) {
	if (!registry) return
	const variants = allocationVariants(allocation)
	const token = variants.map((target) => tokens.get(target)).find((candidate) => !!candidate)
	if (!token) return

	const held = activeAllocations.get(token)
	if (held) {
		const duration = Date.now() - (held.createdAt || Date.now())
		traces.allocations.log?.('Allocation ended:', {
			id: held.id,
			reason: held.reason,
			duration: `${duration}ms`,
		})
	}

	registry.unregister(token)
	for (const target of variants) tokens.delete(target)
	activeAllocations.delete(token)
	activeLiveAllocations.delete(token)
}

export function invalidateAllocation<Allocation extends object>(
	allocation: Allocation,
	label: string = 'invalidateAllocation'
) {
	const info: InvalidationInfo = {
		label,
		at: Date.now(),
		stack: new Error().stack,
	}
	for (const target of allocationVariants(allocation)) {
		invalidatedAllocations.add(target)
		invalidationInfos.set(target, info)
	}
}

export function isAllocationValid<Allocation extends object>(allocation: Allocation): boolean {
	return allocationVariants(allocation).every((target) => !invalidatedAllocations.has(target))
}

export function allocationInvalidationInfo<Allocation extends object>(
	allocation: Allocation
): InvalidationInfo | undefined {
	for (const target of allocationVariants(allocation)) {
		const info = invalidationInfos.get(target)
		if (info) return info
	}
	return undefined
}

export function debugActiveAllocations(): Held[] {
	return [...activeAllocations.values()]
}

export function debugActiveAllocationById(id: string): Held | undefined {
	for (const held of activeAllocations.values()) {
		if (held.id === id) return held
	}
	return undefined
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
