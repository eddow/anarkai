import { vehicles } from 'engine-rules'
import { GcClassed } from 'ssh/board/content/utils'
import type { LooseGood } from 'ssh/board/looseGoods'
import type { FreightLineDefinition, FreightStop } from 'ssh/freight/freight-line'
import { SlottedStorage, SpecificStorage, type Storage } from 'ssh/storage'
import type { GoodType, PickupPlan } from 'ssh/types'
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
			offloadPickupPlan?: PickupPlan
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
}

export type VehicleServiceSerialized =
	| {
			readonly kind: 'line'
			readonly lineIndex: number
			readonly stopIndex: number
			readonly docked: boolean
	  }
	| VehicleMaintenanceServiceSerialized

/** Save format before discriminated `kind` — always a line-freight service. */
export type LegacyLineVehicleServiceSerialized = {
	readonly lineIndex: number
	readonly stopIndex: number
	readonly docked: boolean
}

/**
 * Pre-maintenance discriminator save shape: an empty offload service with no per-kind targets.
 * Maintenance is transient; on load such a service is dropped (the planner re-discovers).
 */
export type LegacyOffloadVehicleServiceSerialized = {
	readonly kind: 'offload'
}

export interface VehicleSerializedState {
	/** Stable fixture/debug label. Not runtime identity. */
	readonly name?: string
	readonly vehicleType: WorldVehicleType
	readonly position: { q: number; r: number }
	readonly goods?: Partial<Record<GoodType, number>>
	readonly servedLineIndices?: readonly number[]
	/** New saves use discriminated `kind`; legacy saves are line-only without `kind`, or pre-maintenance offload. */
	readonly service?:
		| VehicleServiceSerialized
		| LegacyLineVehicleServiceSerialized
		| LegacyOffloadVehicleServiceSerialized
}

/**
 * Index-based save format — replaces {@link VehicleSerializedState}.
 *
 * Array order IS identity: `vehicles[i]` is the `i`-th vehicle. All cross-references
 * are indexes into their respective arrays (freight lines, characters) — no string uids.
 */
export interface SerializedVehicle {
	readonly vehicleType: WorldVehicleType
	readonly position: { q: number; r: number }
	readonly goods?: Partial<Record<GoodType, number>>
	/** Indexes into the freight lines array (position in `game.freightLines`). */
	readonly servedLineIndexes: readonly number[]
	readonly service?: SerializedVehicleService
}

export type SerializedVehicleService = {
	readonly kind: 'line'
	/** Index into the freight lines array. */
	readonly lineIndex: number
	/** Index into `line.stops[]`. */
	readonly stopIndex: number
	readonly docked: boolean
	/** Index into the characters array. */
	readonly operatorIndex?: number
}

export function createVehicleStorage(vehicleType: VehicleType): Storage {
	const vehicleDefinition = vehicles[vehicleType] as Ssh.VehicleDefinition
	const storageSpec = vehicleDefinition.storage
	return 'slots' in storageSpec
		? new SlottedStorage(storageSpec.slots, storageSpec.capacity)
		: new SpecificStorage(storageSpec)
}

function vehicleContentDefinition(
	full: Ssh.VehicleDefinition
): Omit<Ssh.VehicleDefinition, 'storage'> {
	const { storage: _storage, ...rest } = full
	return rest
}

export class Vehicle extends GcClassed<Omit<Ssh.VehicleDefinition, 'storage'>>() {
	declare readonly storage: Storage

	constructor(
		public character: Character | undefined,
		definition: Omit<Ssh.VehicleDefinition, 'storage'>,
		resourceName: VehicleType
	) {
		super()
		this.assignGameContent(definition, resourceName)
		this.storage = createVehicleStorage(resourceName)
	}

	static create(type: VehicleType, character?: Character): Vehicle {
		return new Vehicle(
			character,
			vehicleContentDefinition(vehicles[type] as Ssh.VehicleDefinition),
			type
		)
	}
}
