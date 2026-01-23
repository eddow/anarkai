import { vehicles } from '../../../../assets/game-content'
import { GcClassed, GcClasses } from 'ssh/src/lib/board/content/utils'
import { SlottedStorage, SpecificStorage, type Storage } from 'ssh/src/lib/storage'
import type { Character } from '../character'
export class Vehicle extends GcClassed<Omit<Ssh.VehicleDefinition, 'storage'>>() {
	static class = GcClasses(() => Vehicle, vehicles)
	declare readonly storage: Storage
	constructor(public character?: Character) {
		super()
		const vehicleDefinition = new.target.prototype as unknown as Ssh.VehicleDefinition
		const storageSpec = vehicleDefinition.storage
		this.storage =
			'slots' in storageSpec
				? new SlottedStorage(storageSpec.slots, storageSpec.capacity)
				: new SpecificStorage(storageSpec)
	}
}
