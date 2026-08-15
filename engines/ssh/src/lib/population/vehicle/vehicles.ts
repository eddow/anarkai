import type { FreightLineDefinition } from 'ssh/freight/freight-line'
import type { Game } from 'ssh/game/game'
import { GameObject, withContainer } from 'ssh/game/object'
import type { Character } from 'ssh/population/character'
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
 * Serialize vehicles to the index-based format.
 *
 * @param vehicles       Ordered array of all vehicles (array position = identity).
 * @param lineIndex      Map from {@link FreightLineDefinition} → array index.
 * @param characterIndex Map from {@link Character} → array index.
 */
export function serializeVehicles(
	vehicles: readonly Vehicle[],
	lineIndex: ReadonlyMap<FreightLineDefinition, number>,
	characterIndex: ReadonlyMap<Character, number>
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
			const lineIdx = lineIndex.get(svc.line)
			if (lineIdx !== undefined) {
				service = {
					kind: 'line',
					lineIndex: lineIdx,
					stopIndex: svc.line.stops.indexOf(svc.stop),
					docked: vehicle.isDocked,
					operatorIndex:
						svc.operator && characterIndex.has(svc.operator)
							? characterIndex.get(svc.operator)
							: undefined,
				}
			}
		}

		return {
			vehicleType: vehicle.vehicleType,
			position: { q: coord.q, r: coord.r },
			goods: vehicle.storage.stock,
			servedLineIndexes: vehicle.servedLines
				.map((line) => lineIndex.get(line))
				.filter((idx): idx is number => idx !== undefined),
			service,
		}
	})
}

/**
 * Deserialize vehicles from the index-based format.
 *
 * Creates all vehicles first, then wires cross-references (operators) in a second pass.
 * {@link characters} must already exist in the same order they were serialized.
 */
export function deserializeVehicles(
	game: Game,
	rows: readonly SerializedVehicle[],
	characters: readonly Character[],
	freightLines: readonly FreightLineDefinition[]
): Vehicle[] {
	const vehicles = game.withObjectRegistrationBatch(() =>
		rows.map((row) => {
			const vehicle = new Vehicle(
				game,
				row.vehicleType,
				row.position,
				row.servedLineIndexes
					.map((idx) => freightLines[idx])
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
		if (!row.service || row.service.kind !== 'line') continue
		const line = freightLines[row.service.lineIndex]
		const stop = line?.stops[row.service.stopIndex]
		if (!line || !stop) continue
		const operator =
			row.service.operatorIndex !== undefined ? characters[row.service.operatorIndex] : undefined
		vehicle.service = { line, stop, docked: false, operator } as any
		if (row.service.docked) vehicle.dock()
	}

	return vehicles
}
