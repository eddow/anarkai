import type { WorldVehicleType } from 'ssh/population/vehicle/vehicle'

export const lineFreightVehicleTypes = ['wheelbarrow', 'pickup_truck'] as const

export type LineFreightVehicleType = (typeof lineFreightVehicleTypes)[number]

export function isLineFreightVehicleType(
	vehicleType: WorldVehicleType
): vehicleType is LineFreightVehicleType {
	return (lineFreightVehicleTypes as readonly WorldVehicleType[]).includes(vehicleType)
}
