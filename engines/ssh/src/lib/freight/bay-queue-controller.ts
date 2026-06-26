/**
 * Bay queue controller — local traffic controller for a single bay group.
 *
 * @see engines/ssh/docs/bay-queues.md
 */

import { traces } from 'ssh/dev/debug'
import type { Vehicle } from 'ssh/population/vehicle/entity'
import { applyMergePolicy, collectBranchLabels } from './bay-queue-merge-policy'
import type {
	BayGroup,
	DockRequest,
	DockRequirement,
	MovementGrant,
	RuntimeQueueNode,
	VehicleCapability,
	VehicleCapabilityFilter,
} from './bay-queue-types'

// ─── Injectable callbacks ──────────────────────────────────────────────────

export type VehicleCapabilityResolver = (vehicle: Vehicle) => ReadonlySet<VehicleCapability>
export type EmitAdvanceJobFn = (grant: MovementGrant) => void

export function defaultRoadCapabilityResolver(_vehicle: Vehicle): ReadonlySet<VehicleCapability> {
	return new Set(['road'] as VehicleCapability[])
}

// ─── Round-robin state ────────────────────────────────────────────────────

interface RoundRobinState {
	branchIndex: number
	branchWeights: Map<string, number>
	consecutiveCount: number
}

function createRoundRobinState(branchList: string[]): RoundRobinState {
	const weights = new Map<string, number>()
	for (const b of branchList) weights.set(b, 1)
	return { branchIndex: 0, branchWeights: weights, consecutiveCount: 0 }
}

// ─── Handle equality ──────────────────────────────────────────────────────

function handlesEqual(
	a: { kind: string; [key: string]: any } | undefined,
	b: { kind: string; [key: string]: any } | undefined
): boolean {
	if (!a || !b) return false
	if (a.kind !== b.kind) return false
	switch (a.kind) {
		case 'tile':
			return a.coord.q === b.coord.q && a.coord.r === b.coord.r
		case 'border':
			return a.coord.q === b.coord.q && a.coord.r === b.coord.r
		case 'bay-dock':
			return a.bayUid === b.bayUid && a.dockIndex === b.dockIndex
		case 'local':
			return a.bayGroupId === b.bayGroupId && a.index === b.index
	}
	return false
}

// ─── Controller ────────────────────────────────────────────────────────────

export class BayQueueController {
	readonly bayGroup: BayGroup
	readonly nodes: RuntimeQueueNode[]

	private readonly requests = new Map<Vehicle, DockRequest>()
	private readonly grants = new Map<Vehicle, MovementGrant>()
	private readonly branchList: string[]
	private readonly rrState: RoundRobinState
	private readonly getCapabilities: VehicleCapabilityResolver
	private readonly emitJob: EmitAdvanceJobFn

	constructor(
		bayGroup: BayGroup,
		nodes: RuntimeQueueNode[],
		getCapabilities: VehicleCapabilityResolver,
		emitJob: EmitAdvanceJobFn
	) {
		this.bayGroup = bayGroup
		this.nodes = nodes
		this.getCapabilities = getCapabilities
		this.emitJob = emitJob
		this.branchList = collectBranchLabels(nodes)
		this.rrState = createRoundRobinState(this.branchList)
	}

	// ─── Request lifecycle ────────────────────────────────────────────────

	registerRequest(
		vehicle: Vehicle,
		requirements: readonly DockRequirement[],
		priority: number,
		ingressBranch: string | undefined,
		currentNode: RuntimeQueueNode
	): DockRequest {
		if (this.requests.has(vehicle)) {
			throw new Error(`Vehicle ${vehicle.uid} already has an active dock request`)
		}
		if (!this.nodes.includes(currentNode)) {
			throw new Error(`Current node for vehicle ${vehicle.uid} is not part of this queue graph`)
		}

		for (const node of this.nodes) {
			for (const v of node.occupiedBy) {
				if (v === vehicle) {
					throw new Error(`Vehicle ${vehicle.uid} is already occupying node in this graph`)
				}
			}
			for (const v of node.reservedBy) {
				if (v === vehicle) {
					throw new Error(`Vehicle ${vehicle.uid} is already reserved on node in this graph`)
				}
			}
		}

		if (currentNode.occupiedBy.size + currentNode.reservedBy.size >= currentNode.capacity) {
			throw new Error(
				`Node at capacity (${currentNode.capacity}) — vehicle ${vehicle.uid} cannot enter`
			)
		}

		const branch: string | undefined = ingressBranch ?? currentNode.branch

		const request: DockRequest = {
			vehicle,
			bayGroup: this.bayGroup,
			arrivedAt: Date.now(),
			priority,
			requirements,
			state: 'waiting',
			currentNode,
			ingressBranch: branch,
		}

		currentNode.occupiedBy.add(vehicle)
		vehicle.isInBayQueue = true
		this.requests.set(vehicle, request)
		traces.bay.log?.('request:registered', {
			vehicle: vehicle,
			bayGroupName: this.bayGroup.name,
			branch,
			node: currentNode,
		})
		return request
	}

	cancelRequest(vehicle: Vehicle): void {
		const request = this.requests.get(vehicle)
		if (!request) return

		if (request.currentNode) {
			request.currentNode.occupiedBy.delete(vehicle)
			request.currentNode.reservedBy.delete(vehicle)
		}
		if (request.grantedServiceNode) {
			request.grantedServiceNode.occupiedBy.delete(vehicle)
			request.grantedServiceNode.reservedBy.delete(vehicle)
		}
		const grant = this.grants.get(vehicle)
		if (grant) {
			grant.to.reservedBy.delete(vehicle)
			grant.to.occupiedBy.delete(vehicle)
		}

		this.grants.delete(vehicle)
		request.state = 'cancelled'
		this.requests.delete(vehicle)
		vehicle.isInBayQueue = false
		traces.bay.log?.('request:cancelled', { vehicle: vehicle, hadGrant: !!grant })
	}

	updatePriority(vehicle: Vehicle, priority: number): void {
		const request = this.requests.get(vehicle)
		if (request) request.priority = priority
	}

	// ─── Grant lifecycle ──────────────────────────────────────────────────

	completeMovement(vehicle: Vehicle, grant: MovementGrant): void {
		const active = this.grants.get(vehicle)
		if (active !== grant) {
			grant.to.reservedBy.delete(vehicle)
			traces.bay.warn?.('movement:stale', { vehicle: vehicle, grantActive: !!active })
			return
		}

		const request = this.requests.get(vehicle)
		if (!request) {
			grant.to.reservedBy.delete(vehicle)
			this.grants.delete(vehicle)
			traces.bay.warn?.('movement:orphan', { vehicle: vehicle })
			return
		}

		grant.from.occupiedBy.delete(vehicle)
		grant.from.reservedBy.delete(vehicle)
		grant.to.reservedBy.delete(vehicle)
		grant.to.occupiedBy.add(vehicle)

		request.currentNode = grant.to
		this.grants.delete(vehicle)

		if (grant.to.canService && request.state === 'granted') {
			request.state = 'servicing'
			traces.bay.log?.('movement:completed->servicing', { vehicle: vehicle, node: grant.to })
		} else {
			request.state = 'waiting'
			request.grantedServiceNode = undefined
			traces.bay.log?.('movement:completed->waiting', { vehicle: vehicle, node: grant.to })
		}
	}

	completeService(vehicle: Vehicle): void {
		const request = this.requests.get(vehicle)
		if (!request || request.state !== 'servicing') return

		const grant = this.grants.get(vehicle)
		if (grant) {
			grant.to.reservedBy.delete(vehicle)
			this.grants.delete(vehicle)
		}

		request.state = 'waiting'
		request.grantedServiceNode = undefined
		traces.bay.log?.('service:completed', { vehicle: vehicle, node: request.currentNode })
	}

	// ─── Admission loop ───────────────────────────────────────────────────

	advanceBayQueue(): boolean {
		this.removeExpiredGrants()

		const active = this.activeRequests()
		if (active.length === 0) return false

		const ordering = applyMergePolicy(active, this.bayGroup.mergePolicy, {
			branchList: this.branchList,
			branchIndex: this.rrState.branchIndex,
			branchWeights: this.rrState.branchWeights,
			consecutiveCount: this.rrState.consecutiveCount,
		})

		for (const request of ordering.ordered) {
			if (request.state !== 'waiting') continue
			const current = request.currentNode
			if (!current) continue
			const vehicle = request.vehicle
			if (!vehicle) continue

			const next = this.findAvailableNextNode(current, request, vehicle)
			if (!next) {
				if (!this.bayGroup.mergePolicy.skipBlocked) return false
				continue
			}

			if (!this.tryReserveNode(next, vehicle)) continue
			if (ordering.selectedBranch !== undefined) {
				this.commitBranchSelection(ordering.selectedBranch)
			}

			const grant: MovementGrant = {
				vehicle: request.vehicle,
				from: current,
				to: next,
				expiresAt: Date.now() + 30_000,
			}

			this.grants.set(request.vehicle, grant)

			if (next.canService) {
				request.state = 'granted'
				request.grantedServiceNode = next
				traces.bay.log?.('grant:issued->service', {
					vehicle: request.vehicle,
					from: current,
					to: next,
				})
			} else {
				request.state = 'advancing'
				traces.bay.log?.('grant:issued->hop', {
					vehicle: request.vehicle,
					from: current,
					to: next,
				})
			}

			this.emitJob(grant)
			return true
		}

		return false
	}

	// ─── Grant expiry ─────────────────────────────────────────────────────

	private removeExpiredGrants(): void {
		const now = Date.now()
		for (const [vehicle, grant] of this.grants) {
			if (grant.expiresAt !== undefined && now >= grant.expiresAt) {
				for (const v of grant.to.reservedBy) {
					if (v === vehicle) {
						grant.to.reservedBy.delete(v)
						break
					}
				}
				const request = this.requests.get(vehicle)
				if (request) {
					request.state = 'waiting'
					request.grantedServiceNode = undefined
				}
				this.grants.delete(vehicle)
				traces.bay.warn?.('grant:expired', { vehicle: vehicle })
			}
		}
	}

	// ─── Node availability ─────────────────────────────────────────────────

	private findAvailableNextNode(
		current: RuntimeQueueNode,
		request: DockRequest,
		vehicle: Vehicle
	): RuntimeQueueNode | undefined {
		const caps = this.getCapabilities(vehicle)
		for (const edge of current.outgoing) {
			const target = edge.to
			if (!this.capabilitiesMatch(caps, edge.requires)) continue
			if (!this.capabilitiesMatch(caps, target.accepts)) continue
			if (target.occupiedBy.size + target.reservedBy.size >= target.capacity) continue
			if (target.canService && !this.isCompatibleServiceNode(target, request, caps)) continue
			if (this.isReservedByAnother(target, request.vehicle)) continue
			return target
		}
		return undefined
	}

	// ─── Internal helpers ─────────────────────────────────────────────────

	private findVehicleInNode(node: RuntimeQueueNode, vehicleUid: string): Vehicle | undefined {
		for (const v of node.occupiedBy) {
			if (v.uid === vehicleUid) return v
		}
		for (const v of node.reservedBy) {
			if (v.uid === vehicleUid) return v
		}
		return undefined
	}

	private capabilitiesMatch(
		vehicleCaps: ReadonlySet<VehicleCapability>,
		filter: VehicleCapabilityFilter
	): boolean {
		return filter.every((req) => vehicleCaps.has(req))
	}

	private isCompatibleServiceNode(
		node: RuntimeQueueNode,
		request: DockRequest,
		caps: ReadonlySet<VehicleCapability>
	): boolean {
		if (request.requirements.length === 0) return true
		for (const req of request.requirements) {
			if (!this.capabilitiesMatch(caps, req.capabilityFilter)) continue
			if (req.serviceNodes && req.serviceNodes.length > 0 && node.handle) {
				if (!req.serviceNodes.some((h) => handlesEqual(h, node.handle))) continue
			}
			return true
		}
		return false
	}

	private tryReserveNode(node: RuntimeQueueNode, vehicle: Vehicle): boolean {
		if (node.occupiedBy.size + node.reservedBy.size >= node.capacity) return false
		node.reservedBy.add(vehicle)
		return true
	}

	private isReservedByAnother(node: RuntimeQueueNode, otherVehicle: Vehicle): boolean {
		for (const [vehicle, grant] of this.grants) {
			if (vehicle !== otherVehicle && grant.to === node) return true
		}
		return false
	}

	private commitBranchSelection(selectedBranch: string): void {
		const idx = this.branchList.indexOf(selectedBranch)
		if (idx < 0) return
		const currentBranch =
			this.rrState.branchIndex >= 0 && this.rrState.branchIndex < this.branchList.length
				? this.branchList[this.rrState.branchIndex]
				: undefined
		const weight = this.rrState.branchWeights.get(selectedBranch) ?? 1
		if (selectedBranch === currentBranch && this.rrState.consecutiveCount < weight) {
			this.rrState.consecutiveCount++
		} else {
			this.rrState.branchIndex = idx
			this.rrState.consecutiveCount = 1
		}
	}

	// ─── Queries ──────────────────────────────────────────────────────────

	private activeRequests(): DockRequest[] {
		return [...this.requests.values()].filter((r) => r.state === 'waiting')
	}

	getRequest(vehicle: Vehicle): DockRequest | undefined {
		return this.requests.get(vehicle)
	}
	getGrant(vehicle: Vehicle): MovementGrant | undefined {
		return this.grants.get(vehicle)
	}
	get allRequests(): readonly DockRequest[] {
		return [...this.requests.values()]
	}
	get allGrants(): readonly MovementGrant[] {
		return [...this.grants.values()]
	}
	getVehicleCurrentNode(vehicle: Vehicle): RuntimeQueueNode | undefined {
		return this.requests.get(vehicle)?.currentNode
	}
}

// ─── Invariant registration ────────────────────────────────────────────────

import type { TraceInvariantMap, TraceInvariantResult } from '../dev/debug.ts'
import { registerTraceInvariants } from '../dev/debug.ts'
import { validateBayQueueInvariants } from './bay-queue-invariants'

export function registerBayQueueInvariants(controller?: BayQueueController): void {
	const invariants: TraceInvariantMap = {
		'node-capacity': (): TraceInvariantResult => {
			if (!controller) return { ok: false, message: 'no controller' }
			const results = validateBayQueueInvariants(controller.nodes, controller)
			return results.length === 0 ? { ok: true, message: 'all clear' } : results[0]
		},
		'single-occupancy': (): TraceInvariantResult => {
			if (!controller) return { ok: false, message: 'no controller' }
			const results = validateBayQueueInvariants(controller.nodes, controller)
			return results.length === 0 ? { ok: true, message: 'all clear' } : results[0]
		},
	}
	registerTraceInvariants('bay', invariants)
}
