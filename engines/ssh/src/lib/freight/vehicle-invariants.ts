import type { Character } from 'ssh/population/character'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import { isVehicleLineService } from 'ssh/population/vehicle/vehicle'
import { assert, traces } from '../dev/debug.ts'

export function vehicleTraceAssert(condition: unknown, message: string): asserts condition {
	if (condition) return
	traces.vehicle.error?.(message)
	assert(condition, message)
}

export function assertDrivingVehicleSeam(character: Character): void {
	vehicleTraceAssert(!character.driving || !!character.operates, 'driving implies operates')
	vehicleTraceAssert(
		!character.operates || character.operates.operator?.uid === character.uid,
		'character.operates must point back to the same vehicle operator'
	)
}

export function assertVehicleOperationConsistency(
	vehicle: VehicleEntity,
	character: Character
): void {
	const op = vehicle.service?.operator
	if (op?.uid !== character.uid)
		vehicleTraceAssert(
			character.operates?.uid !== vehicle.uid,
			'vehicle.service.operator must be set to the character operating the vehicle'
		)
	else
		vehicleTraceAssert(
			op.uid === character.uid &&
				character.operates?.uid === vehicle.uid &&
				vehicle.operator?.uid === character.uid,
			'vehicle.service.operator must be the operating character'
		)
}

export function assertDockedSemantics(vehicle: VehicleEntity): void {
	const svc = vehicle.service
	if (!isVehicleLineService(svc) || !svc.docked) return
	const stop = svc.stop
	vehicleTraceAssert('anchor' in stop, 'docked must only be set at a bay anchor stop, not a zone')
	vehicleTraceAssert(!vehicle.position, 'docked vehicles must not keep a world position')
}

export function traceVehicleStockWithoutService(vehicle: VehicleEntity): void {
	if (vehicle.service) return
	const stock = vehicle.storage.stock
	const hasStock = Object.values(stock).some((n) => (n ?? 0) > 0)
	if (hasStock) traces.vehicle.log?.('vehicle has stock without active service', vehicle.uid)
}
