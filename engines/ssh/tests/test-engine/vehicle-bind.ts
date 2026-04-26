import { ensureVehicleServiceStarted } from 'ssh/freight/vehicle-run'
import type { Game } from 'ssh/game/game'
import type { Character } from 'ssh/population/character'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import type { VehicleMaintenanceServiceSpec } from 'ssh/population/vehicle/vehicle'
import { toAxialCoord } from 'ssh/utils/position'

/** Attach line-freight service + operator, then set {@link Character.operates} (test seam). */
export function bindOperatedWheelbarrowLine(
	game: Game,
	character: Character,
	vehicle: VehicleEntity
): void {
	if (!ensureVehicleServiceStarted(vehicle, character, game, character)) {
		throw new Error('bindOperatedWheelbarrowLine: ensureVehicleServiceStarted failed')
	}
	character.operates = vehicle
}

/**
 * Attach maintenance offload service + operator, then set {@link Character.operates} (test seam).
 * Defaults to a `park` maintenance pointed at the vehicle's current tile so tests that just want a
 * driving operator + maintenance service do not need to fabricate per-kind targets themselves.
 */
export function bindOperatedWheelbarrowOffload(
	character: Character,
	vehicle: VehicleEntity,
	spec: VehicleMaintenanceServiceSpec = {
		kind: 'park',
		targetCoord: toAxialCoord(vehicle.position) ?? { q: 0, r: 0 },
	}
): void {
	vehicle.beginMaintenanceService(spec, character)
	character.operates = vehicle
}
