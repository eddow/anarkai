/**
 * Tests for bay queue core modules.
 */

import { describe, expect, it } from 'vitest'
import { BayQueueController, defaultRoadCapabilityResolver } from './bay-queue-controller'
import { buildRuntimeQueueGraph } from './bay-queue-graph-builder'
import { invariantNodeCapacity, invariantSingleNodeOccupancy } from './bay-queue-invariants'
import { applyMergePolicy, branchLabel, collectBranchLabels } from './bay-queue-merge-policy'
import type {
	DockRequest,
	MovementGrant,
	RuntimeQueueNode,
	SerializedBayQueueGraph,
} from './bay-queue-types'

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(
	overrides: Partial<DockRequest> & { vehicleUid: string; arrivedAt: number }
): DockRequest {
	return {
		vehicleUid: overrides.vehicleUid,
		bayGroupUid: 'test-group',
		arrivedAt: overrides.arrivedAt,
		priority: overrides.priority ?? 0,
		requirements: [],
		state: 'waiting',
		ingressBranch: overrides.ingressBranch,
		currentNode: overrides.currentNode,
	}
}

function makeNode(overrides: Partial<RuntimeQueueNode> = {}): RuntimeQueueNode {
	return {
		occupiedBy: overrides.occupiedBy ?? new Set(),
		reservedBy: overrides.reservedBy ?? new Set(),
		capacity: overrides.capacity ?? 1,
		accepts: overrides.accepts ?? ['road'],
		canWait: overrides.canWait ?? true,
		canService: overrides.canService ?? false,
		blocksThroughTraffic: overrides.blocksThroughTraffic ?? true,
		branch: overrides.branch,
		outgoing: overrides.outgoing ?? [],
	} as RuntimeQueueNode
}

function makeVehicle(uid: string) {
	return { uid, vehicleType: 'wheelbarrow' } as any
}

function capturedGrant(controller: BayQueueController): MovementGrant | undefined {
	for (const g of controller.allGrants) return g
	return undefined
}

// ─── Merge policy tests ────────────────────────────────────────────────────

describe('merge policies', () => {
	it('priorityThenFifo orders by priority then arrival', () => {
		const a = makeRequest({ vehicleUid: 'A', arrivedAt: 100, priority: 1 })
		const b = makeRequest({ vehicleUid: 'B', arrivedAt: 50, priority: 2 })
		const c = makeRequest({ vehicleUid: 'C', arrivedAt: 200, priority: 1 })

		const result = applyMergePolicy([a, b, c], { kind: 'priority_then_fifo' })
		expect(result.ordered.map((r) => r.vehicleUid)).toEqual(['B', 'A', 'C'])
	})

	it('globalFifo orders by arrival time only', () => {
		const a = makeRequest({ vehicleUid: 'A', arrivedAt: 100, priority: 99 })
		const b = makeRequest({ vehicleUid: 'B', arrivedAt: 50, priority: 1 })
		const c = makeRequest({ vehicleUid: 'C', arrivedAt: 200, priority: 50 })

		const result = applyMergePolicy([a, b, c], { kind: 'global_fifo' })
		expect(result.ordered.map((r) => r.vehicleUid)).toEqual(['B', 'A', 'C'])
	})

	it('roundRobinByBranch alternates between branches', () => {
		const a = makeRequest({ vehicleUid: 'A', arrivedAt: 100, ingressBranch: 'north' })
		const b = makeRequest({ vehicleUid: 'B', arrivedAt: 50, ingressBranch: 'south' })
		const c = makeRequest({ vehicleUid: 'C', arrivedAt: 200, ingressBranch: 'north' })

		const branchList = ['north', 'south']
		const r0 = applyMergePolicy(
			[a, b, c],
			{ kind: 'round_robin_by_branch' },
			{ branchList, branchIndex: 0 }
		)
		expect(r0.selectedBranch).toBe('north')
		expect(r0.ordered[0].vehicleUid).toBe('A')

		const r1 = applyMergePolicy(
			[a, b, c],
			{ kind: 'round_robin_by_branch' },
			{ branchList, branchIndex: 1 }
		)
		expect(r1.selectedBranch).toBe('south')
		expect(r1.ordered[0].vehicleUid).toBe('B')
	})

	it('branchLabel uses ingressBranch over node.branch', () => {
		const node = makeNode({ branch: 'node-branch' })
		const req = makeRequest({
			vehicleUid: 'A',
			arrivedAt: 100,
			ingressBranch: 'ingress-branch',
			currentNode: node,
		})
		expect(branchLabel(req)).toBe('ingress-branch')
		const req2 = makeRequest({ vehicleUid: 'B', arrivedAt: 100, currentNode: node })
		expect(branchLabel(req2)).toBe('node-branch')
	})

	it('collectBranchLabels returns unique ingress labels', () => {
		const nodes = [
			makeNode({ branch: 'north' }),
			makeNode({ branch: 'north' }),
			makeNode({ branch: 'south' }),
		]
		expect(collectBranchLabels(nodes)).toEqual(['north', 'south'])
	})

	it('collectBranchLabels excludes nodes with incoming edges', () => {
		const ingress = makeNode({ branch: 'north' })
		const merge = makeNode({})
		const service = makeNode({ canService: true })
		ingress.outgoing.push({ to: merge, requires: ['road'] })
		merge.outgoing.push({ to: service, requires: ['road'] })
		expect(collectBranchLabels([ingress, merge, service])).toEqual(['north'])
	})
})

// ─── Graph builder tests ──────────────────────────────────────────────────

describe('queue graph builder', () => {
	const mockResolver = {
		tile(coord: { q: number; r: number }) {
			return { uid: `tile:${coord.q},${coord.r}`, position: { q: coord.q, r: coord.r } } as any
		},
		border(coord: { q: number; r: number }) {
			return { uid: `border:${coord.q},${coord.r}`, position: { q: coord.q, r: coord.r } } as any
		},
		bayDock() {
			return { uid: 'bay-1', hive: {} } as any
		},
	}

	it('throws on unresolved tile handle', () => {
		const s: SerializedBayQueueGraph = {
			bayGroupId: 'test',
			serviceNodes: [],
			nodes: [
				{
					handle: { kind: 'tile', coord: { q: 999, r: 999 } },
					capacity: 1,
					accepts: ['road'],
					canWait: true,
					canService: false,
					blocksThroughTraffic: true,
				},
			],
			edges: [],
			mergePolicy: { kind: 'priority_then_fifo' },
		}
		expect(() => buildRuntimeQueueGraph(s, { ...mockResolver, tile: () => undefined })).toThrow(
			/Tile handle unresolved/
		)
	})

	it('succeeds on a valid graph', () => {
		const s: SerializedBayQueueGraph = {
			bayGroupId: 'test',
			serviceNodes: [{ kind: 'bay-dock', bayUid: 'bay-1', dockIndex: 0 }],
			nodes: [
				{
					handle: { kind: 'tile', coord: { q: 0, r: 0 } },
					capacity: 1,
					accepts: ['road'],
					canWait: true,
					canService: false,
					blocksThroughTraffic: true,
					branch: 'north',
				},
				{
					handle: { kind: 'bay-dock', bayUid: 'bay-1', dockIndex: 0 },
					capacity: 1,
					accepts: ['road'],
					canWait: false,
					canService: true,
					blocksThroughTraffic: false,
				},
			],
			edges: [
				{
					from: { kind: 'tile', coord: { q: 0, r: 0 } },
					to: { kind: 'bay-dock', bayUid: 'bay-1', dockIndex: 0 },
					requires: ['road'],
				},
			],
			mergePolicy: { kind: 'priority_then_fifo' },
		}
		const nodes = buildRuntimeQueueGraph(s, mockResolver)
		expect(nodes).toHaveLength(2)
		expect(nodes[0].outgoing[0].to).toBe(nodes[1])
	})
})

// ─── Controller regression tests ────────────────────────────────────────────

describe('BayQueueController regression', () => {
	it('non-service hops set state to advancing', () => {
		const ingress = makeNode({ branch: 'north' })
		const holding = makeNode({ blocksThroughTraffic: false })
		ingress.outgoing.push({ to: holding, requires: ['road'] })

		const c = new BayQueueController(
			{ uid: 't', name: 't', serviceNodes: [], mergePolicy: { kind: 'priority_then_fifo' } },
			[ingress, holding],
			defaultRoadCapabilityResolver,
			() => {}
		)

		const v = makeVehicle('v1')
		const req = c.registerRequest(v, 't', [], 0, undefined, ingress)
		expect(c.advanceBayQueue()).toBe(true)
		expect(req.state).toBe('advancing')
	})

	it('advancing vehicles are skipped', () => {
		const ingress = makeNode()
		const mid = makeNode()
		const dock = makeNode({ canService: true, blocksThroughTraffic: false })
		ingress.outgoing.push({ to: mid, requires: ['road'] })
		mid.outgoing.push({ to: dock, requires: ['road'] })

		const c = new BayQueueController(
			{ uid: 't', name: 't', serviceNodes: [dock], mergePolicy: { kind: 'priority_then_fifo' } },
			[ingress, mid, dock],
			defaultRoadCapabilityResolver,
			() => {}
		)

		const v = makeVehicle('v1')
		c.registerRequest(v, 't', [], 0, undefined, ingress)
		expect(c.advanceBayQueue()).toBe(true)
		expect(c.getRequest('v1')!.state).toBe('advancing')
		expect(c.advanceBayQueue()).toBe(false)
		const g = capturedGrant(c)!
		c.completeMovement(v, g)
		expect(c.getRequest('v1')!.state).toBe('waiting')
		expect(c.advanceBayQueue()).toBe(true)
		expect(c.getRequest('v1')!.state).toBe('granted')
	})

	it('cancelRequest releases grant target reservation', () => {
		const ingress = makeNode()
		const mid = makeNode()
		ingress.outgoing.push({ to: mid, requires: ['road'] })

		const c = new BayQueueController(
			{ uid: 't', name: 't', serviceNodes: [], mergePolicy: { kind: 'priority_then_fifo' } },
			[ingress, mid],
			defaultRoadCapabilityResolver,
			() => {}
		)

		const v = makeVehicle('v1')
		c.registerRequest(v, 't', [], 0, undefined, ingress)
		c.advanceBayQueue()
		c.cancelRequest(v)
		expect(mid.reservedBy.size).toBe(0)
		expect(ingress.occupiedBy.size).toBe(0)
	})

	it('completeService keeps vehicle on service node for exit grant', () => {
		const ingress = makeNode()
		const dock = makeNode({ canService: true, blocksThroughTraffic: false })
		ingress.outgoing.push({ to: dock, requires: ['road'] })

		const c = new BayQueueController(
			{ uid: 't', name: 't', serviceNodes: [dock], mergePolicy: { kind: 'priority_then_fifo' } },
			[ingress, dock],
			defaultRoadCapabilityResolver,
			() => {}
		)

		const v = makeVehicle('v1')
		c.registerRequest(v, 't', [], 0, undefined, ingress)
		c.advanceBayQueue()
		const g = capturedGrant(c)!
		c.completeMovement(v, g)
		expect(c.getRequest('v1')!.state).toBe('servicing')
		c.completeService(v)
		// Vehicle stays on service node in waiting state for exit grant
		const req = c.getRequest('v1')
		expect(req).toBeDefined()
		expect(req!.state).toBe('waiting')
		expect(req!.currentNode).toBe(dock)
		// Dock is still occupied
		expect(dock.occupiedBy.size).toBe(1)
	})

	it('registerRequest validates capacity and rejects overfill', () => {
		const ingress = makeNode({ capacity: 1, occupiedBy: new Set([makeVehicle('existing')]) })

		const c = new BayQueueController(
			{ uid: 't', name: 't', serviceNodes: [], mergePolicy: { kind: 'priority_then_fifo' } },
			[ingress],
			defaultRoadCapabilityResolver,
			() => {}
		)

		const v = makeVehicle('v2')
		expect(() => c.registerRequest(v, 't', [], 0, undefined, ingress)).toThrow(/capacity/)
	})

	it('registerRequest rejects duplicate vehicle in graph', () => {
		const ingress = makeNode()
		const mid = makeNode()
		ingress.outgoing.push({ to: mid, requires: ['road'] })

		const c = new BayQueueController(
			{ uid: 't', name: 't', serviceNodes: [], mergePolicy: { kind: 'priority_then_fifo' } },
			[ingress, mid],
			defaultRoadCapabilityResolver,
			() => {}
		)

		const v = makeVehicle('v1')
		c.registerRequest(v, 't', [], 0, undefined, ingress)
		expect(() => c.registerRequest(makeVehicle('v1'), 't', [], 0, undefined, mid)).toThrow(
			/already/
		)
	})

	it('completeMovement with wrong grant cleans reservation and returns', () => {
		const ingress = makeNode()
		const mid = makeNode()
		ingress.outgoing.push({ to: mid, requires: ['road'] })

		const c = new BayQueueController(
			{ uid: 't', name: 't', serviceNodes: [], mergePolicy: { kind: 'priority_then_fifo' } },
			[ingress, mid],
			defaultRoadCapabilityResolver,
			() => {}
		)

		const v = makeVehicle('v1')
		c.registerRequest(v, 't', [], 0, undefined, ingress)
		c.advanceBayQueue()

		// Complete with a fake/stale grant
		const fakeTarget = makeNode()
		const fakeGrant: MovementGrant = {
			vehicleUid: 'v1',
			from: ingress,
			to: fakeTarget,
			expiresAt: 0,
		}
		fakeTarget.reservedBy.add(v)

		c.completeMovement(v, fakeGrant)
		// Should clean the reservation on the fake grant target
		let found = false
		for (const rv of fakeTarget.reservedBy) {
			if (rv.uid === 'v1') found = true
		}
		expect(found).toBe(false)
		// Active grant should still exist
		expect([...c.allGrants]).toHaveLength(1)
	})

	it('expired grants are cleaned up and request resets to waiting', async () => {
		const ingress = makeNode()
		const mid = makeNode()
		ingress.outgoing.push({ to: mid, requires: ['road'] })

		const c = new BayQueueController(
			{ uid: 't', name: 't', serviceNodes: [], mergePolicy: { kind: 'priority_then_fifo' } },
			[ingress, mid],
			defaultRoadCapabilityResolver,
			() => {}
		)

		const v = makeVehicle('v1')
		c.registerRequest(v, 't', [], 0, undefined, ingress)
		c.advanceBayQueue()
		expect(c.getRequest('v1')!.state).toBe('advancing')

		// Manually expire the grant
		for (const g of c.allGrants) {
			;(g as any).expiresAt = 0
		}

		// Next advance should clean expired grant and try again
		c.advanceBayQueue()
		expect(c.getRequest('v1')!.state).toBe('advancing') // re-granted
	})
})

// ─── Invariants tests ───────────────────────────────────────────────────────

describe('bay queue invariants', () => {
	it('single occupancy passes', () => {
		const n = [
			makeNode({ occupiedBy: new Set([{ uid: 'v1' } as any]) }),
			makeNode({ occupiedBy: new Set([{ uid: 'v2' } as any]) }),
		]
		expect(invariantSingleNodeOccupancy(n).ok).toBe(true)
	})

	it('single occupancy passes for in-flight (occupied + reserved on different nodes)', () => {
		const v1 = { uid: 'v1' } as any
		const n = [makeNode({ occupiedBy: new Set([v1]) }), makeNode({ reservedBy: new Set([v1]) })]
		expect(invariantSingleNodeOccupancy(n).ok).toBe(true)
	})

	it('single occupancy fails with duplicate occupied', () => {
		const v1 = { uid: 'v1' } as any
		const n = [makeNode({ occupiedBy: new Set([v1]) }), makeNode({ occupiedBy: new Set([v1]) })]
		expect(invariantSingleNodeOccupancy(n).ok).toBe(false)
	})

	it('capacity fails when over', () => {
		const n = [
			makeNode({ occupiedBy: new Set([{ uid: 'a' } as any, { uid: 'b' } as any]), capacity: 1 }),
		]
		expect(invariantNodeCapacity(n).ok).toBe(false)
	})

	it('capacity passes when at limit', () => {
		const n = [makeNode({ occupiedBy: new Set([{ uid: 'a' } as any]), capacity: 2 })]
		expect(invariantNodeCapacity(n).ok).toBe(true)
	})
})
