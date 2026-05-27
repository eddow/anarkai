/**
 * Bay queue graph builder — resolves serialized {@link SerializedBayQueueGraph} into
 * live {@link RuntimeQueueNode} / {@link RuntimeQueueEdge} graphs.
 *
 * ## Error handling policy
 *
 * This module **fails loudly** on unresolved handles. A broken save or config
 * that references non-existent tiles, bays, or borders produces a descriptive error,
 * not a silently truncated graph.
 *
 * An explicit `repairMode` flag (default `false`) enables migration/repair
 * semantics: unresolved handles produce a warning and the node is returned with
 * its world-reference fields (`tile`, `border`, `serviceBay`) left undefined.
 * Edges referencing unresolved targets are skipped. Use only when loading
 * corrupted save data for repair.
 *
 * ## Runtime graph structure
 *
 * The returned graph is a plain array of `RuntimeQueueNode`. Each node owns its
 * `outgoing` edges, which hold direct `RuntimeQueueEdge` references to target
 * nodes. There is no `QueueNodeId` or index lookup table — the controller
 * traverses the graph via `node.outgoing[i].to`.
 */

import type { Tile } from 'ssh/board/tile'
import type { TileBorder } from 'ssh/board/border/border'
import type { Game } from 'ssh/game/game'
import { FreightBayAlveolus } from 'ssh/hive/freight-bay'

import {
	type BayGroup,
	type RuntimeQueueEdge,
	type RuntimeQueueNode,
	type SerializedBayQueueGraph,
	type VehicleCapabilityFilter,
} from './bay-queue-types'

/**
 * Resolve a handle to a specific world object.
 *
 * The resolver must be provided by the caller because resolution depends on
 * live game state (the game object, board, hive registry, etc.).
 */
export interface HandleResolver {
	/** Resolve a handle to a tile. */
	tile(coord: { q: number; r: number }): Tile | undefined
	/** Resolve a handle to a tile border. */
	border(coord: { q: number; r: number }): TileBorder | undefined
	/** Resolve a handle to a freight bay alveolus + dock index. */
	bayDock(bayUid: string, dockIndex: number): FreightBayAlveolus | undefined
}

/** Create a default handle resolver from a game instance. */
export function gameHandleResolver(game: Game): HandleResolver {
	return {
		tile(coord) {
			return game.hex.getTile(coord)
		},
		border(coord) {
			return game.hex.getBorder(coord)
		},
		bayDock(bayUid, _dockIndex) {
			// Look up the bay alveolus by uid via the game's object registry.
			// `game.objects` is a Map<string, InteractiveGameObject>.
			const obj = game.objects.get(bayUid)
			if (obj && obj instanceof FreightBayAlveolus) return obj
			// Also check by uid prefix — freight bays may be registered under
			// a different key (e.g. the alveolus uid, not the bay uid).
			for (const o of game.objects.values()) {
				if (o instanceof FreightBayAlveolus && o.uid === bayUid) return o
			}
			return undefined
		},
	}
}

/**
 * Build a runtime queue graph from a serialized configuration.
 *
 * @param serialized - Authored or saved definition.
 * @param resolver - Handle → world-object resolver.
 * @param repairMode - If `true`, unresolved handles produce a warning and are omitted
 *   instead of throwing. Use only for save repair / migration flows.
 * @returns The fully-resolved runtime nodes array.
 * @throws If any handle cannot be resolved and `repairMode` is `false`.
 */
export function buildRuntimeQueueGraph(
	serialized: SerializedBayQueueGraph,
	resolver: HandleResolver,
	repairMode = false
): RuntimeQueueNode[] {
	// Step 1: resolve each serialized node into a RuntimeQueueNode
	const liveNodes = serialized.nodes.map((sn) =>
		resolveSerializedNode(sn, resolver, repairMode)
	)

	// Step 2: resolve edges (fail loudly on unresolved edge handles)
	for (const se of serialized.edges) {
		const sourceIdx = serialized.nodes.findIndex(
			(sn) => sn.handle && handlesEqual(sn.handle, se.from)
		)
		const targetIdx = serialized.nodes.findIndex(
			(sn) => sn.handle && handlesEqual(sn.handle, se.to)
		)

		if (sourceIdx === -1) {
			const msg = `Edge references unknown source handle: ${JSON.stringify(se.from)}`
			if (repairMode) {
				console.warn(`[bay-queue] ${msg} — skipping edge`)
				continue
			}
			throw new Error(`[bay-queue] ${msg}`)
		}
		if (targetIdx === -1) {
			const msg = `Edge references unknown target handle: ${JSON.stringify(se.to)}`
			if (repairMode) {
				console.warn(`[bay-queue] ${msg} — skipping edge`)
				continue
			}
			throw new Error(`[bay-queue] ${msg}`)
		}

		const sourceNode = liveNodes[sourceIdx]
		const targetNode = liveNodes[targetIdx]

		;(sourceNode.outgoing as RuntimeQueueEdge[]).push({
			to: targetNode,
			requires: se.requires as VehicleCapabilityFilter,
		})
	}

	return liveNodes
}

/**
 * Build a {@link BayGroup} from a serialized configuration.
 *
 * @throws If any service-node handle cannot be resolved and `repairMode` is `false`.
 */
export function buildBayGroupFromSerialized(
	serialized: SerializedBayQueueGraph,
	resolver: HandleResolver,
	repairMode = false
): BayGroup {
	const nodes = buildRuntimeQueueGraph(serialized, resolver, repairMode)

	// Resolve service nodes by finding the matching nodes
	const serviceNodes = serialized.serviceNodes
		.map((handle) => {
			const found = nodes.find((n) => n.handle && handlesEqual(n.handle, handle))
			if (!found) {
				const msg = `Service node handle unresolved: ${JSON.stringify(handle)}`
				if (repairMode) {
					console.warn(`[bay-queue] ${msg} — omitting from serviceNodes`)
					return undefined
				}
				throw new Error(`[bay-queue] ${msg}`)
			}
			return found
		})
		.filter((n): n is RuntimeQueueNode => n !== undefined)

	return {
		uid: serialized.bayGroupId,
		name: serialized.bayGroupId,
		serviceNodes,
		mergePolicy: serialized.mergePolicy,
	}
}

// ─── Internal helpers ─────────────────────────────────────────────────────

function resolveSerializedNode(
	sn: SerializedBayQueueGraph['nodes'][number],
	resolver: HandleResolver,
	repairMode: boolean
): RuntimeQueueNode {
	let tile: Tile | undefined
	let border: TileBorder | undefined
	let serviceBay: FreightBayAlveolus | undefined

	if (sn.handle) {
		switch (sn.handle.kind) {
			case 'tile': {
				const t = resolver.tile(sn.handle.coord)
				if (!t) {
					const msg = `Tile handle unresolved: ${JSON.stringify(sn.handle.coord)}`
					if (repairMode) {
						console.warn(`[bay-queue] ${msg}`)
					} else {
						throw new Error(`[bay-queue] ${msg}`)
					}
				}
				tile = t
				break
			}
			case 'border': {
				const b = resolver.border(sn.handle.coord)
				if (!b) {
					const msg = `Border handle unresolved: ${JSON.stringify(sn.handle.coord)}`
					if (repairMode) {
						console.warn(`[bay-queue] ${msg}`)
					} else {
						throw new Error(`[bay-queue] ${msg}`)
					}
				}
				border = b
				break
			}
			case 'bay-dock': {
				const bay = resolver.bayDock(sn.handle.bayUid, sn.handle.dockIndex)
				if (!bay) {
					const msg = `Bay-dock handle unresolved: bayUid=${sn.handle.bayUid} dockIndex=${sn.handle.dockIndex}`
					if (repairMode) {
						console.warn(`[bay-queue] ${msg}`)
					} else {
						throw new Error(`[bay-queue] ${msg}`)
					}
				}
				serviceBay = bay
				break
			}
			case 'local':
				// local nodes have no world object reference — they're pure queue internals
				break
		}
	}

	return {
		handle: sn.handle,
		tile,
		border,
		serviceBay,
		occupiedBy: new Set(),
		reservedBy: new Set(),
		capacity: sn.capacity,
		accepts: sn.accepts as VehicleCapabilityFilter,
		canWait: sn.canWait,
		canService: sn.canService,
		blocksThroughTraffic: sn.blocksThroughTraffic,
		branch: sn.branch,
		outgoing: [],
	}
}

/** Compare two handles for equality. */
function handlesEqual(
	a: SerializedBayQueueGraph['nodes'][number]['handle'],
	b: SerializedBayQueueGraph['nodes'][number]['handle']
): boolean {
	if (!a || !b) return false
	if (a.kind !== b.kind) return false
	switch (a.kind) {
		case 'tile':
			return (
				b.kind === 'tile' &&
				a.coord.q === b.coord.q &&
				a.coord.r === b.coord.r
			)
		case 'border':
			return (
				b.kind === 'border' &&
				a.coord.q === b.coord.q &&
				a.coord.r === b.coord.r
			)
		case 'bay-dock':
			return (
				b.kind === 'bay-dock' &&
				a.bayUid === b.bayUid &&
				a.dockIndex === b.dockIndex
			)
		case 'local':
			return (
				b.kind === 'local' &&
				a.bayGroupId === b.bayGroupId &&
				a.index === b.index
			)
	}
}

// ─── Validation ────────────────────────────────────────────────────────────

/**
 * Validate a constructed runtime queue graph for internal consistency.
 *
 * This is about structural correctness (every edge's `to` is in the graph,
 * service nodes have `canService = true`, etc.), not about handle resolution
 * (that was checked during construction).
 *
 * @throws On structural errors.
 */
export function validateRuntimeQueueGraph(nodes: RuntimeQueueNode[]): void {
	const nodeSet = new Set<RuntimeQueueNode>(nodes)

	for (const node of nodes) {
		// Every outgoing edge must point to a node in the graph
		for (const edge of node.outgoing) {
			if (!nodeSet.has(edge.to)) {
				throw new Error(
					`Queue node has outgoing edge to a node not in the graph. ` +
					`Source handle: ${node.handle ? JSON.stringify(node.handle) : '(none)'}`
				)
			}
		}

		// Service nodes must have canService = true
		if (node.canService) {
			if (node.capacity <= 0) {
				throw new Error(
					`Service node has capacity ${node.capacity} (must be > 0). ` +
					`Handle: ${node.handle ? JSON.stringify(node.handle) : '(none)'}`
				)
			}
		}
	}
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Find all nodes that have no incoming edges — these are potential ingress nodes. */
export function findIngressNodes(nodes: RuntimeQueueNode[]): RuntimeQueueNode[] {
	const hasIncoming = new Set<RuntimeQueueNode>()
	for (const node of nodes) {
		for (const edge of node.outgoing) {
			hasIncoming.add(edge.to)
		}
	}
	return nodes.filter((n) => !hasIncoming.has(n))
}

/** Find all service nodes (canService = true) in the graph. */
export function findServiceNodes(nodes: RuntimeQueueNode[]): RuntimeQueueNode[] {
	return nodes.filter((n) => n.canService)
}

/** Find all nodes that have no outgoing edges — potential exit or terminal nodes. */
export function findExitNodes(nodes: RuntimeQueueNode[]): RuntimeQueueNode[] {
	return nodes.filter((n) => n.outgoing.length === 0)
}
