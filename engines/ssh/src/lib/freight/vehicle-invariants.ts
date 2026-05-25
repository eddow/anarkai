import type { Character } from 'ssh/population/character'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import { isVehicleLineService } from 'ssh/population/vehicle/vehicle'
import {
	assert,
	registerTraceInvariants,
	traces,
	type TraceInvariantResult,
} from '../dev/debug.ts'

function isCharacter(value: unknown): value is Character {
	return !!value && typeof value === 'object' && 'uid' in value && 'driving' in value
}

function isVehicle(value: unknown): value is VehicleEntity {
	return !!value && typeof value === 'object' && 'uid' in value && 'storage' in value
}

function drivingVehicleSeamResult(character: Character): TraceInvariantResult {
	return {
		ok: !character.driving || !!character.operates,
		message: 'driving implies operates',
		payload: {
			characterUid: character.uid,
			operatesUid: character.operates?.uid,
			driving: character.driving,
		},
	}
}

function operatedVehiclePointsBackResult(character: Character): TraceInvariantResult {
	return {
		ok: !character.operates || character.operates.operator?.uid === character.uid,
		message: 'character.operates must point back to the same vehicle operator',
		payload: {
			characterUid: character.uid,
			operatesUid: character.operates?.uid,
			operatorUid: character.operates?.operator?.uid,
		},
	}
}

function vehicleOperationConsistencyResult(
	vehicle: VehicleEntity,
	character: Character
): TraceInvariantResult {
	const op = vehicle.service?.operator
	const ok =
		op?.uid !== character.uid
			? character.operates?.uid !== vehicle.uid
			: op.uid === character.uid &&
				character.operates?.uid === vehicle.uid &&
				vehicle.operator?.uid === character.uid
	return {
		ok,
		message:
			op?.uid !== character.uid
				? 'vehicle.service.operator must be set to the character operating the vehicle'
				: 'vehicle.service.operator must be the operating character',
		payload: {
			vehicleUid: vehicle.uid,
			characterUid: character.uid,
			serviceOperatorUid: op?.uid,
			characterOperatesUid: character.operates?.uid,
			vehicleOperatorUid: vehicle.operator?.uid,
		},
	}
}

function dockedSemanticsResult(vehicle: VehicleEntity): TraceInvariantResult {
	const svc = vehicle.service
	if (!isVehicleLineService(svc) || !svc.docked) return true
	const stop = svc.stop
	const anchorOk = 'anchor' in stop
	const positionOk = !vehicle.position
	return {
		ok: anchorOk && positionOk,
		message: !anchorOk
			? 'docked must only be set at a bay anchor stop, not a zone'
			: 'docked vehicles must not keep a world position',
		payload: {
			vehicleUid: vehicle.uid,
			lineId: svc.line.id,
			stopId: svc.stop.id,
			docked: svc.docked,
			hasAnchor: anchorOk,
			position: vehicle.position,
		},
	}
}

registerTraceInvariants('vehicle', {
	'driving-implies-operates': (character) =>
		isCharacter(character)
			? drivingVehicleSeamResult(character)
			: {
					ok: false,
					message: 'vehicle invariant expected a character',
					payload: { receivedType: typeof character },
				},
	'operated-vehicle-points-back': (character) =>
		isCharacter(character)
			? operatedVehiclePointsBackResult(character)
			: {
					ok: false,
					message: 'vehicle invariant expected a character',
					payload: { receivedType: typeof character },
				},
	'operation-consistency': (vehicle, character) =>
		isVehicle(vehicle) && isCharacter(character)
			? vehicleOperationConsistencyResult(vehicle, character)
			: {
					ok: false,
					message: 'vehicle invariant expected a vehicle and character',
					payload: {
						vehicleType: typeof vehicle,
						characterType: typeof character,
					},
				},
	'docked-semantics': (vehicle) =>
		isVehicle(vehicle)
			? dockedSemanticsResult(vehicle)
			: {
					ok: false,
					message: 'vehicle invariant expected a vehicle',
					payload: { receivedType: typeof vehicle },
				},
})

export function vehicleTraceAssert(condition: unknown, message: string): asserts condition {
	if (condition) return
	traces.vehicle.error?.(message)
	assert(condition, message)
}

export function assertDrivingVehicleSeam(character: Character): void {
	traces.vehicle.invariant?.['driving-implies-operates'](character)
	traces.vehicle.invariant?.['operated-vehicle-points-back'](character)
	const drivingResult = drivingVehicleSeamResult(character)
	const operatedResult = operatedVehiclePointsBackResult(character)
	vehicleTraceAssert(
		typeof drivingResult === 'boolean' ? drivingResult : drivingResult.ok,
		typeof drivingResult === 'boolean' ? 'driving implies operates' : drivingResult.message!
	)
	vehicleTraceAssert(
		typeof operatedResult === 'boolean' ? operatedResult : operatedResult.ok,
		typeof operatedResult === 'boolean'
			? 'character.operates must point back to the same vehicle operator'
			: operatedResult.message!
	)
}

export function assertVehicleOperationConsistency(
	vehicle: VehicleEntity,
	character: Character
): void {
	traces.vehicle.invariant?.['operation-consistency'](vehicle, character)
	const result = vehicleOperationConsistencyResult(vehicle, character)
	vehicleTraceAssert(
		typeof result === 'boolean' ? result : result.ok,
		typeof result === 'boolean' ? 'vehicle.service.operator must be the operating character' : result.message!
	)
}

export function assertDockedSemantics(vehicle: VehicleEntity): void {
	traces.vehicle.invariant?.['docked-semantics'](vehicle)
	const result = dockedSemanticsResult(vehicle)
	vehicleTraceAssert(
		typeof result === 'boolean' ? result : result.ok,
		typeof result === 'boolean' ? 'docked vehicles must not keep a world position' : result.message!
	)
}

export function traceVehicleStockWithoutService(vehicle: VehicleEntity): void {
	if (vehicle.service) return
	const stock = vehicle.storage.stock
	const hasStock = Object.values(stock).some((n) => (n ?? 0) > 0)
	if (hasStock) traces.vehicle.log?.('vehicle has stock without active service', vehicle.uid)
}
