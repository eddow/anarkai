import { vehicles } from 'engine-rules'
import { GcClassed, GcClasses } from 'ssh/board/content/utils'
import type { FreightLineDefinition, FreightStop } from 'ssh/freight/freight-line'
import { SlottedStorage, SpecificStorage, type Storage } from 'ssh/storage'
import type { GoodType } from 'ssh/types'
import type { Character } from '../character'

export type VehicleType = keyof typeof vehicles

/** World `VehicleEntity` kinds (same as {@link VehicleType}; characters no longer use a rules `onFoot` type). */
export type WorldVehicleType = VehicleType

export interface VehicleService {
	operator?: Character
}

export interface VehicleLineService extends VehicleService {
	line: FreightLineDefinition
	stop: FreightStop
	docked: boolean
}

export interface VehicleOffloadService extends VehicleService {}

/** True when `service` is a line-freight run (has route `line` / `stop` / `docked`). */
export function isVehicleLineService(
	service: VehicleService | undefined
): service is VehicleLineService {
	return !!service && 'line' in service
}

/** True when `service` is maintenance offload (operator-only, no line attachment). */
export function isVehicleOffloadService(
	service: VehicleService | undefined
): service is VehicleOffloadService {
	return !!service && !('line' in service)
}

export type VehicleServiceSerialized =
	| {
			readonly kind: 'line'
			readonly lineId: string
			readonly stopId: string
			readonly docked: boolean
			readonly operatorUid?: string
	  }
	| {
			readonly kind: 'offload'
			readonly operatorUid?: string
	  }

/** Save format before discriminated `kind` — always a line-freight service. */
export type LegacyLineVehicleServiceSerialized = {
	readonly lineId: string
	readonly stopId: string
	readonly docked: boolean
	readonly operatorUid?: string
}

export interface VehicleSerializedState {
	readonly uid: string
	readonly vehicleType: WorldVehicleType
	readonly position: { q: number; r: number }
	readonly goods?: Partial<Record<GoodType, number>>
	readonly servedLineIds: readonly string[]
	/** New saves use discriminated `kind`; legacy saves are line-only without `kind`. */
	readonly service?: VehicleServiceSerialized | LegacyLineVehicleServiceSerialized
}

export function createVehicleStorage(vehicleType: VehicleType): Storage {
	const vehicleDefinition = vehicles[vehicleType] as Ssh.VehicleDefinition
	const storageSpec = vehicleDefinition.storage
	return 'slots' in storageSpec
		? new SlottedStorage(storageSpec.slots, storageSpec.capacity)
		: new SpecificStorage(storageSpec)
}

export class Vehicle extends GcClassed<Omit<Ssh.VehicleDefinition, 'storage'>>() {
	static class = GcClasses(() => Vehicle, vehicles)
	declare readonly storage: Storage
	constructor(public character?: Character) {
		super()
		this.storage = createVehicleStorage(this.name as VehicleType)
	}
}
