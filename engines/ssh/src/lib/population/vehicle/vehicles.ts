import type { FreightLineDefinition } from 'ssh/freight/freight-line'
import type { Game } from 'ssh/game/game'
import { GameObject, withContainer } from 'ssh/game/object'
import { VehicleEntity } from './entity'
import type { VehicleSerializedState, WorldVehicleType } from './vehicle'

export class Vehicles extends withContainer(GameObject) {
	private readonly items = new Map<string, VehicleEntity>()

	constructor(public readonly game: Game) {
		super(game)
	}

	createVehicle(
		uid: string,
		vehicleType: WorldVehicleType,
		position: { q: number; r: number },
		servedLines: readonly FreightLineDefinition[] = []
	): VehicleEntity {
		return this.game.withObjectRegistrationBatch(() => {
			const vehicle = new VehicleEntity(this.game, uid, vehicleType, position, servedLines)
			this.items.set(uid, vehicle)
			this.add(vehicle)
			return vehicle
		})
	}

	vehicle(uid: string): VehicleEntity | undefined {
		return this.items.get(uid)
	}

	removeVehicle(uid: string): boolean {
		const vehicle = this.items.get(uid)
		if (!vehicle) return false
		this.items.delete(uid)
		this.delete(vehicle)
		return true
	}

	serialize(): VehicleSerializedState[] {
		return [...this.items.values()].map((vehicle) => vehicle.serialize())
	}

	deserialize(data: VehicleSerializedState[]): void {
		this.game.withObjectRegistrationBatch(() => {
			this.items.clear()
			this.clear()
			for (const vehicleData of data) {
				const vehicle = VehicleEntity.deserialize(this.game, vehicleData)
				this.items.set(vehicle.uid, vehicle)
				this.add(vehicle)
			}
		})
	}

	[Symbol.iterator]() {
		return this.items.values()
	}
}
