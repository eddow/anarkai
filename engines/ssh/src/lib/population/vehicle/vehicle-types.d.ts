import type { FreightLineDefinition } from '../../freight/freight-line'
import type { GoodType } from '../../types'
import type { VehicleMaintenanceServiceSerialized, WorldVehicleType } from './vehicle'
import { debugObjectId } from 'ssh/dev/debug-object-id'

// ── Service serialization ────────────────────────────────────────────────

/** New save format — uses discriminated `kind`. */
export type VehicleServiceSerialized =
	| {
			readonly kind: 'line'
			readonly line: FreightLineDefinition
			readonly stopIndex: number
			readonly docked: boolean
			readonly operatorUid?: string
	  }
	| VehicleMaintenanceServiceSerialized

/** Save format before discriminated `kind` — always a line-freight service. */
export type LegacyLineVehicleServiceSerialized = {
	readonly line: FreightLineDefinition
	readonly stopIndex: number
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

// ── Vehicle serialization ─────────────────────────────────────────────────

export interface VehicleSerializedState {
	readonly uid: string
	readonly vehicleType: WorldVehicleType
	readonly position: { q: number; r: number }
	readonly goods?: Partial<Record<GoodType, number>>
	readonly servedLines: readonly FreightLineDefinition[]
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
