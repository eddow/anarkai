import type { ZoneDefinition } from 'ssh/board/zone'
import type { FreightLineDefinition } from 'ssh/freight/freight-line'
import type { HivePlan } from 'ssh/hive-plan'
import type { Character } from 'ssh/population/character'
import type { Vehicle } from 'ssh/population/vehicle/entity'

/**
 * Runtime types cross-referenced **by index** in the save file.
 *
 * A field whose type is one of these (or an array of one) serializes as
 * `number` / `number[]`. Registering an entity here is the single place that
 * turns its references into indexes; {@link Serialized} picks that up
 * automatically from the live type.
 */
export interface SerializationRegistry {
	FreightLineDefinition: FreightLineDefinition
	Character: Character
	Vehicle: Vehicle
	ZoneDefinition: ZoneDefinition
	HivePlan: HivePlan
}

/** Any runtime type tracked in the serialization registry. */
export type RegistryObject = SerializationRegistry[keyof SerializationRegistry]

type SerializedField<T> = T extends RegistryObject
	? number
	: T extends ReadonlyArray<infer E>
		? SerializedField<E>[]
		: T extends object
			? Serialized<T>
			: T

/**
 * Automated serialized projection of `T`: every object-reference field becomes
 * its index position (or an array of positions). Derived from the live data
 * model, so `Serialized<T>` can never drift from `T`.
 *
 * `T` must be a **plain persisted-data interface**, not a reactive class with
 * methods/getters/private state. The mapped type distributes over unions so a
 * discriminated union serializes to a union of its serialized members.
 *
 * Example — a live data model and its derived serialized shape:
 *
 * ```ts
 * interface VehicleState {
 * 	vehicleType: WorldVehicleType
 * 	position: { q: number; r: number }
 * 	goods?: Partial<Record<GoodType, number>>
 * 	servedLines: FreightLineDefinition[]   // → number[]
 * 	service?: { line: FreightLineDefinition; operator: Character | undefined } // → { line: number; operator: number }
 * }
 * ```
 */
export type Serialized<T> = T extends unknown ? { [K in keyof T]: SerializedField<T[K]> } : never
