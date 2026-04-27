import { jobBalance } from 'engine-rules'
import type { FreightAdSource, FreightPriorityTier } from 'ssh/freight/priority-channel'

export type VehicleCandidateKind =
	| 'maintenanceLoad'
	| 'maintenanceUnload'
	| 'park'
	| 'zoneLoad'
	| 'zoneProvide'
	| 'dockDemand'
	| 'dockProvide'
	| 'beginService'

export interface VehicleCandidatePolicyInput {
	readonly kind: VehicleCandidateKind
	readonly urgency: number
	readonly distance: number
	readonly priorityTier?: FreightPriorityTier
	readonly adSource?: FreightAdSource
	readonly quantity?: number
	/**
	 * Quantity affects provide-style candidates by default. Set explicitly when another candidate kind
	 * should be ranked by transfer amount without changing its public job urgency.
	 */
	readonly quantityAffectsScore?: boolean
}

export interface VehicleCandidatePolicyScore {
	readonly kind: VehicleCandidateKind
	readonly adSource?: FreightAdSource
	readonly priorityTier?: FreightPriorityTier
	readonly tierWeight: number
	readonly quantityWeight: number
	readonly distanceDenominator: number
	readonly score: number
	readonly fallbackOnly: boolean
}

export function vehicleCandidateTierWeight(priorityTier?: FreightPriorityTier): number {
	return priorityTier ? jobBalance.priorityTier[priorityTier] : 1
}

export function vehicleCandidateFallbackOnly(kind: VehicleCandidateKind): boolean {
	return kind === 'park'
}

function vehicleCandidateQuantityWeight(input: VehicleCandidatePolicyInput): number {
	const shouldUseQuantity =
		input.quantityAffectsScore ??
		(input.kind === 'zoneProvide' || input.kind === 'dockDemand' || input.kind === 'dockProvide')
	if (!shouldUseQuantity) return 1
	const quantity = input.quantity ?? 1
	if (!Number.isFinite(quantity) || quantity <= 0) return 1
	return quantity
}

export function scoreVehicleCandidate(
	input: VehicleCandidatePolicyInput
): VehicleCandidatePolicyScore {
	const tierWeight = vehicleCandidateTierWeight(input.priorityTier)
	const quantityWeight = vehicleCandidateQuantityWeight(input)
	const distanceDenominator = Math.max(0, input.distance) + 1
	const score = (input.urgency * tierWeight * quantityWeight) / distanceDenominator
	return {
		kind: input.kind,
		adSource: input.adSource,
		priorityTier: input.priorityTier,
		tierWeight,
		quantityWeight,
		distanceDenominator,
		score,
		fallbackOnly: vehicleCandidateFallbackOnly(input.kind),
	}
}
