import type { FreightLineDefinition } from 'ssh/freight/freight-line'
import type { Game } from 'ssh/game/game'
import { GameObject, withContainer } from 'ssh/game/object'
import type { SaveIndexes } from 'ssh/serialization'
import { axial } from 'ssh/utils/axial'
import { toAxialCoord } from 'ssh/utils/position'
import { Vehicle } from './entity'
import type { SerializedVehicle, WorldVehicleType } from './vehicle'
import { isVehicleLineService } from './vehicle'

export class Vehicles extends withContainer(GameObject) {
	constructor(public readonly game: Game) {
		super(game)
	}

	createVehicle(
		vehicleType: WorldVehicleType,
		position: { q: number; r: number },
		servedLines: readonly FreightLineDefinition[] = [],
		name?: string
	): Vehicle {
		return this.game.withObjectRegistrationBatch(() => {
			const vehicle = new Vehicle(this.game, vehicleType, position, servedLines, name)
			this.add(vehicle)
			this.game.invalidateWorkPlanning('vehicle.create')
			return vehicle
		})
	}

	removeVehicle(vehicle: Vehicle): boolean {
		if (!this.children.has(vehicle)) return false
		this.delete(vehicle)
		this.game.invalidateWorkPlanning('vehicle.remove')
		return true
	}

	[Symbol.iterator]() {
		const children = this.children
		return iterateChildVehicles(children)
	}
}

function* iterateChildVehicles(children: Set<GameObject>): Generator<Vehicle> {
	for (const child of children) {
		if (child instanceof Vehicle) yield child
	}
}

/**
 * Serialize vehicles to the index-based format, resolving object references
 * through the central {@link SaveIndexes}.
 *
 * @param vehicles Ordered array of all vehicles (array position = identity).
 * @param indexes  Central object ↔ index stores for this save pass.
 */
export function serializeVehicles(
	vehicles: readonly Vehicle[],
	indexes: SaveIndexes
): SerializedVehicle[] {
	return vehicles.map((vehicle) => {
		// A docked vehicle has no world position (`vehicle.position === undefined`);
		// its logical location is the anchor tile. Serialize that so `dock()` can
		// restore cleanly on load instead of relying on a `{ q: 0, r: 0 }` sentinel
		// (which previously threw in `toAxialCoord` and lost the real dock tile).
		const sourcePosition = vehicle.position ?? vehicle.dockTile?.position
		const rawCoord = sourcePosition ? toAxialCoord(sourcePosition) : undefined
		const coord = rawCoord ? axial.round(rawCoord) : { q: 0, r: 0 }
		const svc = vehicle.service

		let service: SerializedVehicle['service']
		if (svc && isVehicleLineService(svc)) {
			const line = indexes.freightLines.toIndex(svc.line)
			if (line !== undefined) {
				service = {
					kind: 'line',
					line,
					stopIndex: svc.line.stops.indexOf(svc.stop),
					docked: vehicle.isDocked,
					operator: svc.operator ? indexes.characters.toIndex(svc.operator) : undefined,
				}
			}
		}

		return {
			vehicleType: vehicle.vehicleType,
			position: { q: coord.q, r: coord.r },
			goods: vehicle.storage.stock,
			servedLines: vehicle.servedLines
				.map((line) => indexes.freightLines.toIndex(line))
				.filter((idx): idx is number => idx !== undefined),
			service,
		}
	})
}

/**
 * Deserialize vehicles from the index-based format, resolving references
 * through the central {@link SaveIndexes} (freight lines and characters must
 * already be registered).
 */
export function deserializeVehicles(
	game: Game,
	rows: readonly SerializedVehicle[],
	indexes: SaveIndexes
): Vehicle[] {
	const vehicles = game.withObjectRegistrationBatch(() =>
		rows.map((row) => {
			const vehicle = new Vehicle(
				game,
				row.vehicleType,
				row.position,
				row.servedLines
					.map((idx) => indexes.freightLines.fromIndex(idx))
					.filter((line): line is FreightLineDefinition => !!line)
			)
			for (const [goodType, qty] of Object.entries(row.goods ?? {})) {
				;(vehicle.storage as any).addGood(goodType, qty)
			}
			return vehicle
		})
	)

	// Second pass: wire service operators
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]
		const vehicle = vehicles[i]
		if (!row.service) continue
		const line = indexes.freightLines.fromIndex(row.service.line)
		const stop = line?.stops[row.service.stopIndex]
		if (!line || !stop) continue
		const operator =
			row.service.operator !== undefined
				? indexes.characters.fromIndex(row.service.operator)
				: undefined
		vehicle.service = { line, stop, docked: false, operator } as any
		if (row.service.docked) vehicle.dock()
	}

	return vehicles
}
