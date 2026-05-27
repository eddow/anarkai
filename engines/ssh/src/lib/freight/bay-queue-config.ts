/**
 * Bay queue auto-generation — derives queue graphs from road/rail topology,
 * bay placement, and parking/siding construction.
 *
 * This module produces {@link SerializedBayQueueGraph} configs that can be
 * passed to {@link buildRuntimeQueueGraph} / {@link buildBayGroupFromSerialized}.
 *
 * ## Strategy
 *
 * - For each freight bay alveolus in a bay group, create a service node
 *   (handle: `bay-dock`).
 * - For each road/rail tile adjacent to the bay (or reachable via a
 *   short path), create ingress nodes.
 * - Connect ingress → service via direct edges (simple case).
 * - Additional holding nodes (parking, siding) are added if the
 *   configuration requests them.
 *
 * This is the "derive automatically from roads, rails, bays, and
 * parking/siding construction" option from the open questions.
 */

import type { AxialCoord } from 'ssh/utils'

import {
	type QueueNodeHandle,
	type SerializedBayQueueGraph,
	type SerializedQueueEdge,
	type SerializedQueueNode,
} from './bay-queue-types'

/**
 * Options controlling auto-generation behavior.
 */
export interface AutoGenerationOptions {
	/** Bay group identifier. */
	readonly bayGroupId: string
	/** Merge policy to use. Defaults to priority_then_fifo. */
	readonly mergePolicyKind?: 'priority_then_fifo' | 'global_fifo'
	/** Whether to create off-path holding nodes (e.g. parking/siding). */
	readonly createHoldingNodes?: boolean
	/** Maximum holding node capacity. */
	readonly holdingCapacity?: number
	/**
	 * Branch labels for ingress nodes, keyed by `axial.key(coord)`.
	 * Use `axial.key({q, r})` to get the string key for a given coordinate.
	 */
	readonly branchLabels?: Map<string, string>
}

/**
 * Generate a simple queue graph for a bay group with a single service bay
 * and one or more ingress tiles.
 *
 * @param bayGroupId - Unique bay group identifier.
 * @param serviceBayCoord - The service bay tile coordinate.
 * @param ingressCoords - Coordinates of ingress tiles (road/rail entries).
 * @param options - Generation options.
 * @returns A serialized graph ready for resolution.
 */
export function generateSimpleQueueGraph(
	bayGroupId: string,
	serviceDockHandle: QueueNodeHandle,
	ingressCoords: readonly AxialCoord[],
	options: AutoGenerationOptions = { bayGroupId }
): SerializedBayQueueGraph {
	const nodes: SerializedQueueNode[] = []

	// Service node (dock)
	const serviceNodeIndex = nodes.length
	nodes.push({
		handle: serviceDockHandle,
		capacity: 1,
		accepts: ['road'],
		canWait: false,
		canService: true,
		blocksThroughTraffic: false,
	})

	// Ingress nodes
	const edges: SerializedQueueEdge[] = []
	for (const coord of ingressCoords) {
		const ingressHandle: QueueNodeHandle = {
			kind: 'tile',
			coord: { q: coord.q, r: coord.r },
		}

		const index = nodes.length
		const coordKey = `${coord.q},${coord.r}`
		const branch = options.branchLabels?.get(coordKey)

		nodes.push({
			handle: ingressHandle,
			capacity: 1,
			accepts: ['road'],
			canWait: true,
			canService: false,
			blocksThroughTraffic: true,
			branch,
		})

		// Direct edge: ingress → service
		edges.push({
			from: ingressHandle,
			to: serviceDockHandle,
			requires: ['road'],
		})

		// If holding nodes requested, add an off-path waiting node
		if (options.createHoldingNodes) {
			const holdingHandle: QueueNodeHandle = {
				kind: 'local',
				bayGroupId,
				index: nodes.length,
			}

			nodes.push({
				handle: holdingHandle,
				capacity: options.holdingCapacity ?? 4,
				accepts: ['road', 'offroad'],
				canWait: true,
				canService: false,
				blocksThroughTraffic: false,
			})

			// Ingress → holding (requires offroad)
			edges.push({
				from: ingressHandle,
				to: holdingHandle,
				requires: ['road', 'offroad'],
			})

			// Holding → service
			edges.push({
				from: holdingHandle,
				to: serviceDockHandle,
				requires: ['road'],
			})
		}
	}

	return {
		bayGroupId,
		serviceNodes: [serviceDockHandle],
		nodes,
		edges,
		mergePolicy: {
			kind: options.mergePolicyKind ?? 'priority_then_fifo',
		},
	}
}

/**
 * Generate a queue graph for a bay group with multiple interchangeable
 * service bays.
 *
 * Each service bay gets its own service node. Ingress nodes connect to
 * all service nodes. A merge gate node sits between ingress and service
 * nodes.
 */
export function generateMultiBayQueueGraph(
	bayGroupId: string,
	serviceDockHandles: readonly QueueNodeHandle[],
	ingressCoords: readonly AxialCoord[],
	options: AutoGenerationOptions = { bayGroupId }
): SerializedBayQueueGraph {
	const nodes: SerializedQueueNode[] = []

	// Service nodes
	const serviceHandles: QueueNodeHandle[] = []
	for (const handle of serviceDockHandles) {
		serviceHandles.push(handle)
		nodes.push({
			handle,
			capacity: 1,
			accepts: ['road'],
			canWait: false,
			canService: true,
			blocksThroughTraffic: false,
		})
	}

	// Merge gate node (purely internal, referenced by local handle)
	const mergeHandle: QueueNodeHandle = {
		kind: 'local',
		bayGroupId,
		index: nodes.length,
	}
	nodes.push({
		handle: mergeHandle,
		capacity: 1,
		accepts: ['road'],
		canWait: false,
		canService: false,
		blocksThroughTraffic: true,
	})

	const edges: SerializedQueueEdge[] = []

	// Ingress → merge gate
	for (const coord of ingressCoords) {
		const ingressHandle: QueueNodeHandle = {
			kind: 'tile',
			coord: { q: coord.q, r: coord.r },
		}

		const coordKey = `${coord.q},${coord.r}`
		const branch = options.branchLabels?.get(coordKey)

		nodes.push({
			handle: ingressHandle,
			capacity: 1,
			accepts: ['road'],
			canWait: true,
			canService: false,
			blocksThroughTraffic: true,
			branch,
		})

		edges.push({
			from: ingressHandle,
			to: mergeHandle,
			requires: ['road'],
		})
	}

	// Merge gate → each service node
	for (const handle of serviceHandles) {
		edges.push({
			from: mergeHandle,
			to: handle,
			requires: ['road'],
		})
	}

	return {
		bayGroupId,
		serviceNodes: serviceHandles,
		nodes,
		edges,
		mergePolicy: {
			kind: options.mergePolicyKind ?? 'priority_then_fifo',
		},
	}
}

// ─── Config helpers ────────────────────────────────────────────────────────

/**
 * Parse a YAML-like config into serialized bay queue graphs.
 *
 * This is a lightweight parser; for production use, a full YAML library
 * + validation layer would be appropriate.
 */
export function parseBayQueueConfig(
	config: BayQueueConfigInput
): SerializedBayQueueGraph[] {
	return config.bayGroups.map((group) => ({
		bayGroupId: group.id,
		serviceNodes: group.serviceNodes.map((sn) => sn.handle),
		nodes: group.queueGraph.nodes.map((n) => ({
			handle: n.handle,
			capacity: n.capacity,
			accepts: n.accepts,
			canWait: n.canWait,
			canService: n.canService,
			blocksThroughTraffic: n.blocksThroughTraffic,
			branch: n.branch,
		})),
		edges: group.queueGraph.edges.map((e) => ({
			from: e.from,
			to: e.to,
			requires: e.requires,
		})),
		mergePolicy: group.queueGraph.mergePolicy,
	}))
}

/** Input shape matching the YAML config sketch from the spec. */
export interface BayQueueConfigInput {
	readonly bayGroups: ReadonlyArray<{
		readonly id: string
		readonly serviceNodes: ReadonlyArray<{ readonly handle: QueueNodeHandle }>
		readonly queueGraph: {
			readonly nodes: ReadonlyArray<{
				readonly handle?: QueueNodeHandle
				readonly capacity: number
				readonly accepts: readonly string[]
				readonly canWait: boolean
				readonly canService: boolean
				readonly blocksThroughTraffic: boolean
				readonly branch?: string
			}>
			readonly edges: ReadonlyArray<{
				readonly from: QueueNodeHandle
				readonly to: QueueNodeHandle
				readonly requires: readonly string[]
			}>
			readonly mergePolicy: {
				readonly kind: 'priority_then_fifo' | 'global_fifo' | 'round_robin_by_branch'
			}
		}
	}>
}
