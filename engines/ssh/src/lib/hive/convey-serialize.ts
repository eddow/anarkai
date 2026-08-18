import {
	type FreightMovementParty,
	isVehicleFreightDock,
	type VehicleFreightDock,
} from 'ssh/freight/vehicle-freight-dock'
import type { Vehicle } from 'ssh/population/vehicle/entity'
import type { IndexStore } from 'ssh/serialization'
import type { GoodType } from 'ssh/types'
import type { AxialCoord } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'

/** Serialized freight endpoint for save/load (no runtime object refs). */
export type SerializedFreightPartyRef =
	| { kind: 'alveolus'; coord: readonly [number, number] }
	| { kind: 'vehicleDock'; vehicleIndex: number; bayCoord: readonly [number, number] }

/**
 * One active movement row in save order; array index is the serialization identity.
 * Breaking format: older saves without `conveyMovements` load with no in-flight convey.
 */
export interface SerializedConveyMovement {
	readonly goodType: GoodType
	readonly path: readonly AxialCoord[]
	readonly from: AxialCoord
	readonly provider: SerializedFreightPartyRef
	readonly demander: SerializedFreightPartyRef
	readonly claimed: boolean
	/** Save/load-only reference. Runtime uses the live object reference on `TrackedMovement.claimedBy`. */
	readonly claimedByCharacterIndex?: number
	readonly claimedAtMs?: number
}

export function serializeFreightParty(
	party: FreightMovementParty,
	vehicles?: IndexStore<Vehicle>
): SerializedFreightPartyRef {
	const { q, r } = toAxialCoord(party.tile.position)
	const coord = [q, r] as const
	if (isVehicleFreightDock(party)) {
		const dock = party as VehicleFreightDock
		return {
			kind: 'vehicleDock',
			vehicleIndex: vehicles?.toIndex(dock.vehicle) ?? -1,
			bayCoord: coord,
		}
	}
	return { kind: 'alveolus', coord }
}
