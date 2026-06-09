/**
 * Bay queue registry — global registry of bay groups, their controllers,
 * and the mapping between freight bays and bay groups.
 *
 * ## Responsibilities
 *
 * - Own the mapping from `bayGroupUid` → `BayQueueController`.
 * - Own the mapping from bay tile / FreightBayAlveolus → `bayGroupUid`.
 * - Provide vehicle lifecycle hooks: enter queue, leave queue, complete service.
 * - Integrate with the game ticker to run `advanceBayQueue` when triggered.
 * - Resolve `VehicleEntity` references from UIDs for the controllers.
 *
 * The registry is the single integration point between the bay queue system
 * and the rest of the engine.
 */

import type { Tile } from 'ssh/board/tile'
import type { Game } from 'ssh/game/game'
import type { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import type { BayQueueController } from './bay-queue-controller'
import type { DockRequirement } from './bay-queue-types'

/**
 * Callback when a movement grant needs to become a concrete vehicle-hop job.
 *
 * The integration layer (NPC script / work planner) implements this to
 * create the actual pathfinding + move-to job for the vehicle.
 */
export type OnMovementGrantFn = (
	vehicleUid: string,
	fromNode: { tile?: Tile; serviceBay?: FreightBayAlveolus },
	toNode: { tile?: Tile; serviceBay?: FreightBayAlveolus }
) => void

export class BayQueueRegistry {
	/** bayGroupUid → controller */
	private readonly controllers = new Map<string, BayQueueController>()

	/** bay tile uid → bayGroupUid */
	private readonly bayToBayGroup = new Map<string, string>()

	/** All known bay groups (for iteration). */
	private readonly bayGroupIds = new Set<string>()

	constructor(game: Game) {
		this.game = game
	}

	// ─── Registration ────────────────────────────────────────────────────

	/**
	 * Register a controller for a bay group.
	 *
	 * The caller builds the controller (with its graph and merge policy)
	 * before registering it here.
	 */
	registerController(bayGroupUid: string, controller: BayQueueController): void {
		if (this.controllers.has(bayGroupUid)) {
			throw new Error(`Bay group ${bayGroupUid} already registered`)
		}
		this.controllers.set(bayGroupUid, controller)
		this.bayGroupIds.add(bayGroupUid)
	}

	/** Remove a bay group and its controller. */
	unregisterBayGroup(bayGroupUid: string): void {
		this.controllers.delete(bayGroupUid)
		this.bayGroupIds.delete(bayGroupUid)
		// Clean up bay → group mappings
		for (const [bayUid, groupUid] of this.bayToBayGroup) {
			if (groupUid === bayGroupUid) this.bayToBayGroup.delete(bayUid)
		}
	}

	/**
	 * Associate a freight bay alveolus with a bay group.
	 * Called when bay groups are configured or auto-generated.
	 */
	associateBay(bay: FreightBayAlveolus, bayGroupUid: string): void {
		this.bayToBayGroup.set(bay.uid, bayGroupUid)
	}

	// ─── Lookup ──────────────────────────────────────────────────────────

	getController(bayGroupUid: string): BayQueueController | undefined {
		return this.controllers.get(bayGroupUid)
	}

	getBayGroupUidForBay(bay: FreightBayAlveolus): string | undefined {
		return this.bayToBayGroup.get(bay.uid)
	}

	/**
	 * Find the bay group that a given freight bay belongs to.
	 */
	findBayGroupForBay(bay: FreightBayAlveolus): BayQueueController | undefined {
		const groupUid = this.bayToBayGroup.get(bay.uid)
		if (!groupUid) return undefined
		return this.controllers.get(groupUid)
	}

	/** Get all registered bay group uids. */
	get allBayGroupUids(): readonly string[] {
		return [...this.bayGroupIds]
	}

	// ─── Vehicle lifecycle hooks ─────────────────────────────────────────

	/**
	 * Called when a vehicle enters the queue graph for a bay group.
	 *
	 * The vehicle should already be positioned on an ingress node.
	 * The controller finds the node based on the vehicle's world position.
	 */
	onVehicleEnterQueue(
		vehicle: VehicleEntity,
		bayGroupUid: string,
		requirements: readonly DockRequirement[],
		priority: number,
		ingressBranch?: string
	): void {
		const controller = this.controllers.get(bayGroupUid)
		if (!controller) {
			throw new Error(`Unknown bay group: ${bayGroupUid}`)
		}

		// Find the node the vehicle is currently on
		const currentNode = this.findNodeForVehicle(controller, vehicle)
		if (!currentNode) {
			throw new Error(
				`Vehicle ${vehicle.uid} is not positioned on any node in bay group ${bayGroupUid}`
			)
		}

		controller.registerRequest(
			vehicle,
			bayGroupUid,
			requirements,
			priority,
			ingressBranch,
			currentNode
		)

		// Trigger admission loop
		controller.advanceBayQueue()
	}

	/** Called when a vehicle leaves the queue graph. */
	onVehicleLeaveQueue(vehicle: VehicleEntity): void {
		for (const [_groupUid, controller] of this.controllers) {
			if (controller.getRequest(vehicle.uid)) {
				controller.cancelRequest(vehicle)
			}
		}
	}

	/** Called when a vehicle completes a movement. */
	onVehicleMovementComplete(vehicle: VehicleEntity): void {
		for (const [, controller] of this.controllers) {
			const grant = controller.getGrant(vehicle.uid)
			if (grant) {
				controller.completeMovement(vehicle, grant)
			}
		}
	}

	/** Called when a vehicle completes service at a dock. */
	onVehicleServiceComplete(vehicle: VehicleEntity): void {
		for (const [, controller] of this.controllers) {
			const request = controller.getRequest(vehicle.uid)
			if (request && request.state === 'servicing') {
				controller.completeService(vehicle)
				// After service, re-run admission to let others advance
				controller.advanceBayQueue()
			}
		}
	}

	// ─── Tick ─────────────────────────────────────────────────────────────

	/**
	 * Run the admission loop for all registered controllers.
	 *
	 * Called each simulation tick. Returns the number of grants issued.
	 */
	updateAllQueues(): number {
		let grantsIssued = 0
		for (const [, controller] of this.controllers) {
			if (controller.advanceBayQueue()) {
				grantsIssued++
			}
		}
		return grantsIssued
	}

	// ─── Internal helpers ─────────────────────────────────────────────────

	/**
	 * Find which runtime queue node a vehicle is currently positioned on.
	 *
	 * Matches by comparing the vehicle's world tile to each node's tile/border/serviceBay.
	 */
	private findNodeForVehicle(
		controller: BayQueueController,
		vehicle: VehicleEntity
	): NonNullable<ReturnType<typeof controller.getVehicleCurrentNode>> | undefined {
		const vehicleTile = vehicle.worldTile
		if (!vehicleTile) return undefined

		for (const node of controller.nodes) {
			if (node.tile && node.tile === vehicleTile) return node
			if (node.serviceBay && node.serviceBay.tile === vehicleTile) return node
			// For border nodes, check if vehicle is on that border
			if (node.border) {
				const vehicleCoord = vehicle.position
				if (vehicleCoord) {
					// Compare positions (approximate match)
					const nodePos = node.border.position
					if (typeof nodePos === 'object' && 'q' in nodePos) {
						const vc = 'x' in vehicleCoord ? { q: vehicleCoord.x, r: vehicleCoord.y } : vehicleCoord
						if (
							Math.abs((vc as any).q - (nodePos as any).q) < 0.001 &&
							Math.abs((vc as any).r - (nodePos as any).r) < 0.001
						) {
							return node
						}
					}
				}
			}
		}

		return undefined
	}
}
