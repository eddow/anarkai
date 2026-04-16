import { ensureVehicleServiceStarted } from 'ssh/freight/vehicle-run'
import type { Game } from 'ssh/game/game'
import type { Character } from 'ssh/population/character'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'

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

/** Attach maintenance offload service + operator, then set {@link Character.operates} (test seam). */
export function bindOperatedWheelbarrowOffload(character: Character, vehicle: VehicleEntity): void {
	vehicle.beginOffloadService(character)
	character.operates = vehicle
}
