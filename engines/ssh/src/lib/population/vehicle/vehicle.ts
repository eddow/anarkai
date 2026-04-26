import { vehicles } from 'engine-rules'
import { GcClassed, GcClasses } from 'ssh/board/content/utils'
import type { LooseGood } from 'ssh/board/looseGoods'
import type { FreightLineDefinition, FreightStop } from 'ssh/freight/freight-line'
import { SlottedStorage, SpecificStorage, type Storage } from 'ssh/storage'
import type { GoodType } from 'ssh/types'
import type { AxialCoord } from 'ssh/utils'
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

/**
 * Maintenance offload run. Discriminated by {@link VehicleMaintenanceService.kind}:
 * - `'loadFromBurden'`: pick up a specific {@link LooseGood} from a burdening tile.
 * - `'unloadToTile'`: drop carried stock onto a non-burdening `UnBuiltLand` tile.
 * - `'park'`: move an empty burdening vehicle onto a non-burdening tile, then end service.
 *
 * Per-kind state lives on the service so scripts read intent from `vehicle.service` instead of the
 * transient `jobPlan` payload (see [`docs/vehicle-interactions.md`]).
 */
export type VehicleMaintenanceService =
	| {
			kind: 'loadFromBurden'
			operator?: Character
			looseGood: LooseGood
			targetCoord: AxialCoord
	  }
	| {
			kind: 'unloadToTile'
			operator?: Character
			targetCoord: AxialCoord
	  }
	| {
			kind: 'park'
			operator?: Character
			targetCoord: AxialCoord
	  }

export type VehicleMaintenanceKind = VehicleMaintenanceService['kind']

/**
 * Distributive `Omit<…, 'operator'>` over the {@link VehicleMaintenanceService} union: keeps each
 * sub-kind's per-kind fields visible to callers of {@link VehicleEntity.beginMaintenanceService}.
 */
export type VehicleMaintenanceServiceSpec = VehicleMaintenanceService extends infer T
	? T extends VehicleMaintenanceService
		? Omit<T, 'operator'>
		: never
	: never

/** True when `service` is a line-freight run (has route `line` / `stop` / `docked`). */
export function isVehicleLineService(
	service: VehicleService | undefined
): service is VehicleLineService {
	return !!service && 'line' in service
}

/** True when `service` is a maintenance offload (load-from-burden / unload-to-tile / park). */
export function isVehicleMaintenanceService(
	service: VehicleService | undefined
): service is VehicleMaintenanceService {
	return !!service && 'kind' in service
}

/**
 * Maintenance services are transient (one offload run, then `endService()`); save format only
 * records the sub-kind + target so the planner can re-validate on load. `loadFromBurden` does not
 * persist its `LooseGood` reference: on load the planner re-discovers a fresh maintenance pick.
 */
export type VehicleMaintenanceServiceSerialized = {
	readonly kind: 'maintenance'
	readonly maintenanceKind: VehicleMaintenanceKind
	readonly targetCoord: { q: number; r: number }
	readonly operatorUid?: string
}

export type VehicleServiceSerialized =
	| {
			readonly kind: 'line'
			readonly lineId: string
			readonly stopId: string
			readonly docked: boolean
			readonly operatorUid?: string
	  }
	| VehicleMaintenanceServiceSerialized

/** Save format before discriminated `kind` — always a line-freight service. */
export type LegacyLineVehicleServiceSerialized = {
	readonly lineId: string
	readonly stopId: string
	readonly docked: boolean
	readonly operatorUid?: string
}

/**
 * Pre-maintenance discriminator save shape: an empty offload service with no per-kind targets.
 * Maintenance is transient; on load such a service is dropped (the planner re-discovers).
 */
export type LegacyOffloadVehicleServiceSerialized = {
	readonly kind: 'offload'
	readonly operatorUid?: string
}

export interface VehicleSerializedState {
	readonly uid: string
	readonly vehicleType: WorldVehicleType
	readonly position: { q: number; r: number }
	readonly goods?: Partial<Record<GoodType, number>>
	readonly servedLineIds: readonly string[]
	/** New saves use discriminated `kind`; legacy saves are line-only without `kind`, or pre-maintenance offload. */
	readonly service?:
		| VehicleServiceSerialized
		| LegacyLineVehicleServiceSerialized
		| LegacyOffloadVehicleServiceSerialized
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
