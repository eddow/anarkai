import type { FreightMovementParty } from 'ssh/freight/vehicle-freight-dock'
import type { TrackedMovement } from 'ssh/hive/hive'
import type { Character } from 'ssh/population/character'
import type { GoodType } from 'ssh/types/base'
import type { TraceInvariantResult } from '../dev/debug.ts'

export type FreightTransferPurpose =
	| 'consume'
	| 'stock'
	| 'transit'
	| 'load-vehicle'
	| 'unload-vehicle'

export type FreightTransferPhase =
	| 'planned'
	| 'advertised'
	| 'claimed'
	| 'carrying'
	| 'delivered'
	| 'cancelled'
	| 'failed'

export type FreightTransferReason =
	| 'local-need'
	| 'local-stock-buffer'
	| 'downstream-need'
	| 'line-transit'
	| 'vehicle-surplus'
	| 'market-import'
	| 'market-export'

export interface FreightDemandRef {
	readonly id: string
	readonly goodType: GoodType
	readonly quantity: number
	readonly owner:
		| 'construction'
		| 'transform'
		| 'hive-buffer'
		| 'freight-line'
		| 'vehicle-line-stop'
		| 'market'
	readonly acceptsAt?: FreightMovementParty
}

export interface FreightOfferRef {
	readonly id: string
	readonly goodType: GoodType
	readonly quantity: number
	readonly owner: 'storage' | 'vehicle' | 'transform' | 'market' | 'loose-good'
	readonly providesFrom?: FreightMovementParty
}

export interface FreightTransferClaim {
	readonly characterUid: string
	readonly claimedAtMs: number
	readonly scriptName: 'work.convey' | 'work.conveyStep'
}

/**
 * Semantic metadata for a movement that bridges offer economy and demand economy.
 *
 * This is intended to migrate onto dock-created `TrackedMovement` objects instead of creating a
 * second parallel transfer runtime.
 */
export interface FreightTransferMeta {
	readonly id: string
	readonly goodType: GoodType
	readonly quantity: number
	readonly phase: FreightTransferPhase
	readonly purpose: FreightTransferPurpose
	readonly reason: FreightTransferReason
	readonly source: FreightMovementParty
	readonly target: FreightMovementParty
	readonly demand?: FreightDemandRef
	readonly offer?: FreightOfferRef
	readonly routePromiseId?: string
	readonly lineId?: string
	readonly stopId?: string
	readonly vehicleUid?: string
	readonly bayUid?: string
	readonly blocking?: boolean
	readonly claim?: FreightTransferClaim
}

export type MovementWithFreightTransfer = TrackedMovement & {
	freightTransfer?: FreightTransferMeta
}

export interface VehicleLineIntent {
	readonly vehicleUid: string
	readonly lineId: string
	readonly stopId: string
	readonly kind: 'load' | 'unload' | 'hop' | 'park' | 'wait'
	readonly reason:
		| 'current-stop-unload'
		| 'current-stop-load'
		| 'downstream-need'
		| 'surplus'
		| 'line-complete'
	readonly priority: number
	readonly blocking: boolean
	readonly goodType?: GoodType
	readonly quantity?: number
	readonly source?: FreightMovementParty
	readonly target?: FreightMovementParty
}

export function movementTransfer(movement: TrackedMovement): FreightTransferMeta | undefined {
	return (movement as MovementWithFreightTransfer).freightTransfer
}

export function isBlockingFreightTransfer(meta: FreightTransferMeta | undefined): boolean {
	return !!meta && meta.blocking === true && !isTerminalFreightTransferPhase(meta.phase)
}

export function isTerminalFreightTransferPhase(phase: FreightTransferPhase): boolean {
	return phase === 'delivered' || phase === 'cancelled' || phase === 'failed'
}

export function characterOwnsFreightTransferClaim(
	character: Character | undefined,
	transferId: string
): boolean {
	if (!character) return false
	const action = character.actionDescription ?? []
	if (action.includes('work.convey') || action.includes('work.conveyStep')) {
		return character.runningScripts.some(
			(script) =>
				(script.name === 'work.convey' || script.name === 'work.conveyStep') &&
				script.state &&
				typeof script.state === 'object' &&
				'transferId' in script.state &&
				script.state.transferId === transferId
		)
	}
	return false
}

export const freightTransferInvariantIds = {
	blockingTransferHasExecutableJob: 'freight.transfer.blocking-transfer-has-executable-job',
	claimHasLiveConveyOwner: 'freight.transfer.claim-has-live-convey-owner',
	reservedCargoIsNotLocalOffer: 'freight.transfer.reserved-cargo-is-not-local-offer',
	candidatesAreNotBlockers: 'freight.transfer.candidates-are-not-blockers',
	transitHasLocalRoutePromise: 'freight.transfer.transit-has-local-route-promise',
} as const

export interface BlockingTransferExecutableJobContext {
	readonly transfer: FreightTransferMeta
	readonly hasExecutableJob: boolean
	readonly claimOwner?: Character
}

export interface ClaimHasLiveConveyOwnerContext {
	readonly transfer: FreightTransferMeta
	readonly claimOwner?: Character
}

export interface ReservedCargoLocalOfferContext {
	readonly transfer: FreightTransferMeta
	readonly advertisedAsLocalOffer: boolean
}

export interface CandidatesAreNotBlockersContext {
	readonly blockedOnlyByCandidates: boolean
	readonly hasBlockingExecutionState: boolean
	readonly candidateCount: number
}

function freightTransferPayload(transfer: FreightTransferMeta): Record<string, unknown> {
	return {
		transferId: transfer.id,
		goodType: transfer.goodType,
		quantity: transfer.quantity,
		phase: transfer.phase,
		purpose: transfer.purpose,
		reason: transfer.reason,
		lineId: transfer.lineId,
		stopId: transfer.stopId,
		vehicleUid: transfer.vehicleUid,
		bayUid: transfer.bayUid,
		blocking: transfer.blocking,
		routePromiseId: transfer.routePromiseId,
	}
}

export const freightTransferInvariantChecks = {
	[freightTransferInvariantIds.blockingTransferHasExecutableJob]: ({
		transfer,
		hasExecutableJob,
		claimOwner,
	}: BlockingTransferExecutableJobContext): TraceInvariantResult => {
		const ok =
			!isBlockingFreightTransfer(transfer) ||
			hasExecutableJob ||
			characterOwnsFreightTransferClaim(claimOwner, transfer.id)
		return {
			ok,
			message:
				'blocking freight transfer must have an executable job or live convey claim owner',
			payload: {
				...freightTransferPayload(transfer),
				hasExecutableJob,
				claimOwnerUid: claimOwner?.uid,
			},
		}
	},
	[freightTransferInvariantIds.claimHasLiveConveyOwner]: ({
		transfer,
		claimOwner,
	}: ClaimHasLiveConveyOwnerContext): TraceInvariantResult => {
		const ok = !transfer.claim || characterOwnsFreightTransferClaim(claimOwner, transfer.id)
		return {
			ok,
			message: 'claimed freight transfer must be owned by a live convey executor',
			payload: {
				...freightTransferPayload(transfer),
				claimOwnerUid: claimOwner?.uid,
				claimedByUid: transfer.claim?.characterUid,
				claimedAtMs: transfer.claim?.claimedAtMs,
			},
		}
	},
	[freightTransferInvariantIds.reservedCargoIsNotLocalOffer]: ({
		transfer,
		advertisedAsLocalOffer,
	}: ReservedCargoLocalOfferContext): TraceInvariantResult => {
		const reservedForLater =
			!!transfer.routePromiseId ||
			transfer.purpose === 'transit' ||
			transfer.reason === 'downstream-need' ||
			transfer.reason === 'line-transit'
		return {
			ok: !reservedForLater || !advertisedAsLocalOffer,
			message: 'reserved freight cargo must not advertise as generic local provide',
			payload: {
				...freightTransferPayload(transfer),
				advertisedAsLocalOffer,
				reservedForLater,
			},
		}
	},
	[freightTransferInvariantIds.candidatesAreNotBlockers]: ({
		blockedOnlyByCandidates,
		hasBlockingExecutionState,
		candidateCount,
	}: CandidatesAreNotBlockersContext): TraceInvariantResult => ({
		ok: !blockedOnlyByCandidates || hasBlockingExecutionState,
		message: 'freight candidates may explain transfers but must not block by themselves',
		payload: {
			blockedOnlyByCandidates,
			hasBlockingExecutionState,
			candidateCount,
		},
	}),
	[freightTransferInvariantIds.transitHasLocalRoutePromise]: (
		transfer: FreightTransferMeta
	): TraceInvariantResult => ({
		ok:
			transfer.purpose !== 'transit' ||
			!!transfer.routePromiseId ||
			!!transfer.demand?.id,
		message: 'transit freight transfer must name the local route promise it serves',
		payload: freightTransferPayload(transfer),
	}),
} as const
