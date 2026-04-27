import {
	type FreightMovementParty,
	isVehicleFreightDock,
	type VehicleFreightDock,
} from 'ssh/freight/vehicle-freight-dock'
import type { GoodType } from 'ssh/types'
import type { AxialCoord } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'

/** Serialized freight endpoint for save/load (no runtime object refs). */
export type SerializedFreightPartyRef =
	| { kind: 'alveolus'; coord: readonly [number, number] }
	| { kind: 'vehicleDock'; vehicleUid: string; bayCoord: readonly [number, number] }

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
	readonly claimedByUid?: string
	readonly claimedAtMs?: number
}

export function serializeFreightParty(party: FreightMovementParty): SerializedFreightPartyRef {
	const { q, r } = toAxialCoord(party.tile.position)
	const coord = [q, r] as const
	if (isVehicleFreightDock(party)) {
		const dock = party as VehicleFreightDock
		return { kind: 'vehicleDock', vehicleUid: dock.vehicle.uid, bayCoord: coord }
	}
	return { kind: 'alveolus', coord }
}
