/**
 * Bay queue invariants — runtime validators for queue state consistency.
 *
 * Mirrors the invariants listed in {@link engines/ssh/docs/bay-queues.md#invariants}.
 *
 * These are designed to be called from trace-invariant hooks (like the existing
 * vehicle invariants in {@link ./vehicle-invariants.ts}) or from unit/integration
 * test assertions.
 */

import { debugObjectId } from 'ssh/dev/debug-object-id'
import type { Vehicle } from 'ssh/population/vehicle/entity'
import type { BayQueueController } from './bay-queue-controller'
import type { RuntimeQueueNode } from './bay-queue-types'

// ─── Invariant result type ────────────────────────────────────────────────

/**
 * Mirrors {@link TraceInvariantResult} from `dev/debug.ts` to keep this module
 * import-light. Real trace integration can wrap these results.
 */
export interface QueueInvariantResult {
	readonly ok: boolean
	readonly message: string
	readonly payload?: Record<string, unknown>
}

// ─── Invariants ───────────────────────────────────────────────────────────

/**
 * A vehicle occupies at most one queue node at a time.
 *
 * During a legitimate in-flight movement the vehicle is in `occupiedBy` on the
 * source node and `reservedBy` on the target. This counts as one occupied node
 * plus one reservation — not a violation. We only flag vehicles that appear in
 * `occupiedBy` across **multiple** nodes, or appear in `reservedBy` across
 * multiple nodes without also being occupied somewhere.
 */
export function invariantSingleNodeOccupancy(nodes: RuntimeQueueNode[]): QueueInvariantResult {
	const occupiedCount = new Map<Vehicle, number>()
	const reservedCount = new Map<Vehicle, number>()

	for (const node of nodes) {
		for (const v of node.occupiedBy) {
			occupiedCount.set(v, (occupiedCount.get(v) ?? 0) + 1)
		}
		for (const v of node.reservedBy) {
			reservedCount.set(v, (reservedCount.get(v) ?? 0) + 1)
		}
	}

	const violations: Array<{ vehicleUid: string; reason: string }> = []

	for (const [vehicle, count] of occupiedCount) {
		if (count > 1) {
			violations.push({
				vehicleUid: debugObjectId(vehicle) ?? 'unknown',
				reason: `occupied on ${count} nodes`,
			})
		}
	}
	for (const [vehicle, count] of reservedCount) {
		if (count > 1) {
			violations.push({
				vehicleUid: debugObjectId(vehicle) ?? 'unknown',
				reason: `reserved on ${count} nodes`,
			})
		}
	}

	return {
		ok: violations.length === 0,
		message: 'vehicle may occupy at most one queue node (reservations are separate)',
		payload: violations.length > 0 ? { violations } : undefined,
	}
}

/**
 * A queue node's occupied + reserved count must not exceed capacity.
 */
export function invariantNodeCapacity(nodes: RuntimeQueueNode[]): QueueInvariantResult {
	const violations: Array<{ node: string; capacity: number; total: number }> = []

	for (const node of nodes) {
		const total = node.occupiedBy.size + node.reservedBy.size
		if (total > node.capacity) {
			violations.push({
				node: node.handle ? JSON.stringify(node.handle) : '(anonymous)',
				capacity: node.capacity,
				total,
			})
		}
	}

	return {
		ok: violations.length === 0,
		message: 'node occupied + reserved must not exceed capacity',
		payload: violations.length > 0 ? { violations } : undefined,
	}
}

/**
 * A concrete service node reservation must belong to a vehicle already in
 * the queue graph.
 *
 * Check: for every node with `reservedBy` entries and `canService === true`,
 * the reserved vehicle must appear in some node's `occupiedBy`.
 */
export function invariantServiceReservationInGraph(
	nodes: RuntimeQueueNode[]
): QueueInvariantResult {
	const allOccupied = new Set<Vehicle>()
	for (const node of nodes) {
		for (const v of node.occupiedBy) {
			allOccupied.add(v)
		}
	}

	const violations: string[] = []
	for (const node of nodes) {
		if (!node.canService) continue
		for (const v of node.reservedBy) {
			if (!allOccupied.has(v)) {
				violations.push(debugObjectId(v) ?? 'unknown')
			}
		}
	}

	return {
		ok: violations.length === 0,
		message: 'service-node reservations must belong to vehicles in the queue graph',
		payload: violations.length > 0 ? { violations } : undefined,
	}
}

/**
 * A movement grant must reserve its target before the vehicle starts moving.
 *
 * Check: for every active grant, the target node must have the vehicle in
 * its `reservedBy` set.
 */
export function invariantGrantTargetReserved(controller: BayQueueController): QueueInvariantResult {
	const violations: string[] = []

	for (const grant of controller.allGrants) {
		let found = false
		for (const v of grant.to.reservedBy) {
			if (v === grant.vehicle) {
				found = true
				break
			}
		}
		if (!found) violations.push(debugObjectId(grant.vehicle) ?? 'unknown')
	}

	return {
		ok: violations.length === 0,
		message: 'movement grants must have their target node reserved',
		payload: violations.length > 0 ? { violations } : undefined,
	}
}

/**
 * Off-path waiting is just a node that does not block through traffic.
 *
 * This is a definition — no real invariant violation, but we can check
 * that `blocksThroughTraffic` values match expectations for known node types.
 */
export function invariantBlockingSemantics(nodes: RuntimeQueueNode[]): QueueInvariantResult {
	// Inline nodes (on roads/rails) should typically block through traffic.
	// Off-path nodes (parking, siding) should typically NOT block.
	// This is advisory, not a hard rule — the config may deliberately choose
	// to place inline nodes that don't block.
	const warnings: string[] = []

	for (const node of nodes) {
		if (node.canService && node.blocksThroughTraffic) {
			warnings.push(
				`Service node ${node.handle ? JSON.stringify(node.handle) : '(anonymous)'} ` +
					`has blocksThroughTraffic=true — dock should not block through traffic`
			)
		}
	}

	return {
		ok: true, // Advisory only
		message: 'blocking semantics check (advisory)',
		payload: warnings.length > 0 ? { warnings } : undefined,
	}
}

/**
 * Run all queue invariants against a set of nodes and controller.
 *
 * Returns only failing results (ok === false).
 */
export function validateBayQueueInvariants(
	nodes: RuntimeQueueNode[],
	controller?: BayQueueController
): QueueInvariantResult[] {
	const results: QueueInvariantResult[] = [
		invariantSingleNodeOccupancy(nodes),
		invariantNodeCapacity(nodes),
		invariantServiceReservationInGraph(nodes),
		invariantBlockingSemantics(nodes),
	]

	if (controller) {
		results.push(invariantGrantTargetReserved(controller))
	}

	return results.filter((r) => !r.ok)
}
