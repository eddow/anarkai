/**
 * Core types for the bay queue system.
 *
 * Follows the design in {@link engines/ssh/docs/bay-queues.md} with a clean split:
 *
 * - **Serialized / authored**: stable handles (`QueueNodeHandle`), save-game state with
 *   only the handles needed to rebuild across loads. Edges and service-node lists use
 *   handles, not runtime object references.
 * - **Runtime**: direct object references (`RuntimeQueueNode`, `RuntimeQueueEdge`,
 *   `VehicleEntity`, `Tile`, `TileBorder`, `FreightBayAlveolus`), cached paths, and
 *   active movement grants. No `QueueNodeId` appears in runtime types — the controller
 *   works entirely with object identity.
 */

import type { AxialCoord } from 'ssh/utils'

// ─── Vehicle capability ────────────────────────────────────────────────────

/** Vehicle capability enum — vehicle type is not the main branching concept. */
export type VehicleCapability =
	| 'road'
	| 'rail'
	| 'offroad'
	| 'canWaitOffNetwork'
	| 'canReverse'

/**
 * A node or edge is tagged with a set of required capabilities.
 * A vehicle can use that resource only if it supplies *all* of the listed capabilities.
 */
export type VehicleCapabilityFilter = readonly VehicleCapability[]

// ─── Queue node handle (stable, serializable) ──────────────────────────────

/**
 * Stable handle to a queue node position.
 *
 * Used in saved state, authored configuration, line-stop references, and edge defs.
 * At load / build time these are resolved into {@link RuntimeQueueNode} references.
 *
 * - `tile`: references a hex tile by integer axial coords.
 * - `border`: references a tile border by its fractional axial position.
 * - `bay-dock`: references a specific dock slot within a freight bay alveolus.
 * - `local`: internal node within a bay group, referenced by stable index
 *   (used for merge gates, holding positions that no outside system needs to address).
 */
export type QueueNodeHandle =
	| { readonly kind: 'tile'; readonly coord: AxialCoord }
	| { readonly kind: 'border'; readonly coord: { readonly q: number; readonly r: number } }
	| { readonly kind: 'bay-dock'; readonly bayUid: string; readonly dockIndex: number }
	| { readonly kind: 'local'; readonly bayGroupId: string; readonly index: number }

// ─── Merge policy ──────────────────────────────────────────────────────────

export type MergePolicyKind =
	| 'global_fifo'
	| 'priority_then_fifo'
	| 'round_robin_by_branch'
	| 'weighted_round_robin_by_branch'
	| 'physical_first_available'

/** Merge policy configuration. Default is `priority_then_fifo`. */
export interface MergePolicy {
	readonly kind: MergePolicyKind
	/**
	 * When the first logical candidate cannot physically move, should the queue
	 * skip to the next candidate (`true`) or stall until unblocked (`false`)?
	 */
	readonly skipBlocked?: boolean
}

// ─── Serialized / authored types ───────────────────────────────────────────

/** Serialized queue node with optional stable handle for externally-addressed nodes. */
export interface SerializedQueueNode {
	readonly handle?: QueueNodeHandle
	readonly capacity: number
	readonly accepts: readonly string[]
	readonly canWait: boolean
	readonly canService: boolean
	readonly blocksThroughTraffic: boolean
	/**
	 * Optional branch label for round-robin merge policies.
	 * Nodes that share the same branch label are treated as one logical ingress
	 * branch regardless of their physical position.
	 */
	readonly branch?: string
}

/** Serialized edge linking two handles. */
export interface SerializedQueueEdge {
	readonly from: QueueNodeHandle
	readonly to: QueueNodeHandle
	readonly requires: readonly string[]
}

/** Serialized merge policy config. */
export interface SerializedMergePolicy {
	readonly kind: MergePolicyKind
	readonly skipBlocked?: boolean
}

/**
 * Serialized (save-safe) bay queue graph configuration.
 *
 * All nodes, edges, service-node lists, ingress/exit lists use handles.
 * A save/load cycle persists this form; the runtime form is reconstructed
 * by resolving handles against the current game world.
 */
export interface SerializedBayQueueGraph {
	readonly bayGroupId: string
	readonly serviceNodes: readonly QueueNodeHandle[]
	readonly nodes: readonly SerializedQueueNode[]
	readonly edges: readonly SerializedQueueEdge[]
	readonly mergePolicy: SerializedMergePolicy
}

/** Serialized dock request — only `waiting` or `servicing` states are persisted. */
export interface SerializedDockRequest {
	readonly vehicleUid: string
	readonly bayGroupId: string
	/** Handle to the node the vehicle currently occupies, if in the graph. */
	readonly queueNode?: QueueNodeHandle
	readonly arrivedAt: number
	readonly priority: number
	readonly state: 'waiting' | 'servicing'
	/**
	 * The ingress branch label this vehicle entered through.
	 * Persisted so round-robin fairness survives a save/load cycle.
	 */
	readonly ingressBranch?: string
}

// ─── Runtime types (transient, live object references) ─────────────────────

// Forward-declare the types that RuntimeQueueNode references.
// These are actual classes in the ssh engine; we import them where needed
// and use `type` imports here to avoid circular deps.
import type { Tile } from 'ssh/board/tile'
import type { TileBorder } from 'ssh/board/border/border'
import type { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'

/**
 * Runtime queue node — live simulation state.
 *
 * Holds direct references to the world objects it represents. Occupancy and
 * reservations are tracked as `Set<VehicleEntity>` for O(1) lookup.
 * `outgoing` edges point directly to their target `RuntimeQueueNode`.
 */
export interface RuntimeQueueNode {
	/** Stable handle if this node is externally addressable (tile, bay, etc.). */
	readonly handle?: QueueNodeHandle
	/** World tile this node occupies, if any. */
	readonly tile?: Tile
	/** World border this node occupies, if any. */
	readonly border?: TileBorder
	/** Freight bay alveolus this node represents (only for service nodes). */
	readonly serviceBay?: FreightBayAlveolus
	/** Vehicles currently occupying this node. */
	readonly occupiedBy: Set<VehicleEntity>
	/** Vehicles that have been granted movement into this node but haven't arrived yet. */
	readonly reservedBy: Set<VehicleEntity>
	/** Authored properties carried from the serialized node. */
	readonly capacity: number
	readonly accepts: VehicleCapabilityFilter
	readonly canWait: boolean
	readonly canService: boolean
	readonly blocksThroughTraffic: boolean
	/** Branch label for round-robin merge policies. */
	readonly branch?: string
	/** Outgoing edges (live references to target nodes). */
	readonly outgoing: RuntimeQueueEdge[]
}

/**
 * Runtime queue edge — live reference to a target node.
 *
 * No `from` field is needed because edges are stored in their source node's
 * `outgoing` array. The controller traverses the graph by following
 * `node.outgoing[i].to`.
 */
export interface RuntimeQueueEdge {
	readonly to: RuntimeQueueNode
	readonly requires: VehicleCapabilityFilter
}

/**
 * A bay group at runtime.
 *
 * Holds live references to its service nodes and merge policy.
 * The full queue graph is reachable via `serviceNodes` and their
 * `outgoing` edges (the graph is owned by the bay group and never
 * shared across groups).
 */
export interface BayGroup {
	readonly uid: string
	readonly name: string
	/** Live references to service/dock nodes. */
	readonly serviceNodes: RuntimeQueueNode[]
	/** Merge policy for this bay group. */
	readonly mergePolicy: MergePolicy
}

/** Dock requirements attached to a dock request (serialized form uses handles). */
export interface DockRequirement {
	readonly capabilityFilter: VehicleCapabilityFilter
	/** Handles of acceptable service nodes. */
	readonly serviceNodes: readonly QueueNodeHandle[]
}

// ─── Dock request (runtime) ────────────────────────────────────────────────

export type DockRequestState = 'waiting' | 'advancing' | 'granted' | 'servicing' | 'cancelled'

/**
 * A vehicle's local intent to receive service from a bay group.
 *
 * `arrivedAt` is the time the vehicle entered the local queue system, not the
 * time the line planned the trip. This gives a stable local order without
 * remotely locking docks.
 */
export interface DockRequest {
	readonly vehicleUid: string
	readonly bayGroupUid: string
	readonly arrivedAt: number
	priority: number
	readonly requirements: readonly DockRequirement[]
	state: DockRequestState
	/** The runtime node the vehicle currently occupies (if in the graph). */
	currentNode?: RuntimeQueueNode
	/** The service node granted for docking (only when `state === 'granted'`). */
	grantedServiceNode?: RuntimeQueueNode
	/**
	 * The ingress branch label this vehicle entered through.
	 * Set once when the vehicle first enters the queue graph and never changes,
	 * so round-robin branch identity is stable even as the vehicle advances
	 * through merge gates and holding positions.
	 */
	readonly ingressBranch?: string
}

// ─── Movement grant (runtime) ──────────────────────────────────────────────

/**
 * A short-lived permission to move from one queue node to another.
 *
 * Moving into a service node uses the same mechanism — a concrete dock
 * reservation is just a movement grant whose target is a service node.
 */
export interface MovementGrant {
	readonly vehicleUid: string
	readonly from: RuntimeQueueNode
	readonly to: RuntimeQueueNode
	readonly expiresAt?: number
	/** Precomputed path tiles (optional, resolved at grant time). */
	readonly path?: readonly AxialCoord[]
}

// ─── Runtime bay queue (top-level controller state) ────────────────────────

/**
 * Full runtime state of a single bay group's queue controller.
 *
 * The `nodes` array owns all runtime nodes. The graph topology is stored
 * in each node's `outgoing` edges. No `QueueNodeId` is used — all
 * relationships are direct object references.
 */
export interface RuntimeBayQueue {
	readonly bayGroup: BayGroup
	readonly nodes: RuntimeQueueNode[]
	readonly requests: DockRequest[]
	readonly grants: MovementGrant[]
}

// ─── Merge policy ordering result ──────────────────────────────────────────

/**
 * Result of a merge-policy ordering pass.
 *
 * The policy says "here is the logical order and here is which branch is
 * selected." The controller checks physical feasibility and only commits
 * round-robin state changes after a grant is issued.
 */
export interface MergeOrdering {
	/** Candidates in logical order (highest priority first). */
	readonly ordered: DockRequest[]
	/**
	 * Which branch label the policy selected this cycle.
	 * `undefined` for global policies that don't track branches.
	 */
	readonly selectedBranch?: string
}
