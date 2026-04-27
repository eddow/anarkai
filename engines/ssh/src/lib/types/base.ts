import { scope, type } from 'arktype'
import { alveoli, deposits, goods as goodsCatalog, terrain } from 'engine-rules'
import type { TileContent } from 'ssh/board'
import type { LooseGood } from 'ssh/board/looseGoods'
import type { FreightAdSource, FreightPriorityTier } from 'ssh/freight/priority-channel'
import type { AllocationBase } from 'ssh/storage/storage'
import { type AxialCoord, type Positioned, positionScope } from 'ssh/utils'

/**
 * Base Game Scope
 *
 * Foundation scope containing game content enums and common validators.
 * This is separated to avoid circular dependencies - domain files can import
 * this without importing the full arktype.ts
 */

// Extract keys for enums
const goodTypes = Object.keys(goodsCatalog) as Array<keyof typeof goodsCatalog>
const terrainTypes = Object.keys(terrain) as Array<keyof typeof terrain>
const depositTypes = Object.keys(deposits) as Array<keyof typeof deposits>
const alveolusTypes = Object.keys(alveoli) as Array<keyof typeof alveoli>

// Base scope with game content enums, validation helpers, job types, and plan types
// ALL TYPES DEFINED WITH STRINGS ONLY!
export const baseGameScope = scope({
	...positionScope.export(),
	// Game content enums
	GoodType: type.enumerated(...goodTypes),
	TerrainType: type.enumerated(...terrainTypes),
	DepositType: type.enumerated(...depositTypes),
	AlveolusType: type.enumerated(...alveolusTypes),

	// Job and activity types (planner-visible vehicle freight: vehicleOffload, vehicleHop, zoneBrowse only)
	JobType: type.enumerated(
		'harvest',
		'transform',
		'convey',
		'vehicleOffload',
		'construct',
		'foundation',
		'defragment',
		'vehicleHop',
		'zoneBrowse'
	),
	// These should be only the classes of the activities, it specifies the energy management (hunger, fatigue, ...)
	ActivityType: type.enumerated('idle', 'walk', 'work', 'eat', 'sleep', 'fight'),
	NeedType: type.enumerated('hunger', 'tiredness', 'fatigue'),

	// Goods type - commonly used (Partial<Record<GoodType, number>>)
	Goods: Object.fromEntries(goodTypes.map((gt) => [`${gt}?`, 'number'])),

	// Job and Needs types
	Job: {
		job: 'JobType',
		fatigue: 'number',
		urgency: 'number',
	},
	Needs: {
		hunger: 'number',
		tiredness: 'number',
		fatigue: 'number',
	},

	// Plan types (all string-based!)
	TransferPlan: {
		type: "'transfer'",
		description: "'grab' | 'drop' | 'idle'",
		goods: 'Goods',
		'target?': 'object',
		'sourceTile?': 'object',
	},

	PickupPlan: {
		type: "'pickup'",
		goodType: 'GoodType',
		'target?': 'object',
	},

	GenericWorkPlan: {
		type: "'work'",
		job: "'harvest' | 'transform' | 'convey' | 'construct' | 'foundation' | 'defragment' | 'vehicleHop' | 'zoneBrowse'",
		target: 'object', // TileContent validated at runtime
		urgency: 'number',
		fatigue: 'number',
		'goodType?': 'GoodType',
		'quantity?': 'number',
		'zoneBrowseAction?': "'load' | 'provide'",
		'lineId?': 'string',
		'bay?': 'AxialCoord',
		'site?': 'AxialCoord',
		'pathToBay?': 'AxialCoord[]',
		'pathToSite?': 'AxialCoord[]',
		'vehicleUid?': 'string',
		'stopId?': 'string',
		'targetCoord?': 'AxialCoord',
		'path?': 'AxialCoord[]',
		'dockEnter?': 'boolean',
		/** Walk to vehicle hex before boarding (line-hop prelude; not a separate planner job). */
		'approachPath?': 'AxialCoord[]',
		/** True when the wheelbarrow still needs line service attached before hop prepare. */
		'needsBeginService?': 'boolean',
		/** Set by `vehicleHopPrepare` when line service ends before travel/dock; NPC script skips tail. */
		'vehicleHopRunEnded?': 'boolean',
		/**
		 * `vehicleHop` only: `vehicleHopPrepare` advanced the active line service to a different stop
		 * than the one this plan was built for, so the script must return and let the planner pick a
		 * fresh hop instead of executing a stale tail against the new stop.
		 */
		'vehicleHopReplanRequired?': 'boolean',
		/**
		 * `vehicleHop` only: set by `vehicleHopDockStep` after a bay anchor dock — the operator already
		 * disembarked while keeping line service; NPC script must not run zone-browse transfer prelude.
		 */
		'vehicleHopAnchorDockDisembarked?': 'boolean',
		/** Set when a stale approach reaches a vehicle now operated by another worker. */
		'vehicleApproachAborted?': 'boolean',
		// Additional fields depend on job type (path, etc.)
	},

	VehicleOffloadWorkPlan: {
		type: "'work'",
		job: "'vehicleOffload'",
		target: 'object',
		urgency: 'number',
		fatigue: 'number',
		/** Maintenance sub-kind hint used by `allocateVehicleServiceForJob`; scripts read from `vehicle.service`. */
		maintenanceKind: "'loadFromBurden' | 'unloadToTile' | 'park'",
		vehicleUid: 'string',
		targetCoord: 'Position',
		'looseGood?': 'object',
		'path?': 'AxialCoord[]',
		'offloadPickupPlan?': 'PickupPlan',
		/** Set when a stale approach reaches a vehicle now operated by another worker. */
		'vehicleApproachAborted?': 'boolean',
	},

	/** Runtime contract only; matches {@link LoadOntoVehicleWorkPlan} (script step, not a {@link Job}). */
	LoadOntoVehicleWorkPlanArk: {
		type: "'work'",
		job: "'loadOntoVehicle'",
		target: 'object',
		urgency: 'number',
		fatigue: 'number',
		vehicleUid: 'string',
		goodType: 'GoodType',
		path: 'AxialCoord[]',
	},

	UnloadFromVehicleWorkPlanArk: {
		type: "'work'",
		job: "'unloadFromVehicle'",
		target: 'object',
		urgency: 'number',
		fatigue: 'number',
		vehicleUid: 'string',
		goodType: 'GoodType',
		quantity: 'number',
		path: 'AxialCoord[]',
	},

	ProvideFromVehicleWorkPlanArk: {
		type: "'work'",
		job: "'provideFromVehicle'",
		target: 'object',
		urgency: 'number',
		fatigue: 'number',
		vehicleUid: 'string',
		goodType: 'GoodType',
		quantity: 'number',
		path: 'AxialCoord[]',
	},

	IdlePlan: {
		type: "'idle'",
		duration: 'number',
	},

	WorkPlan: () =>
		baseGameScope.type(
			'GenericWorkPlan | VehicleOffloadWorkPlan | LoadOntoVehicleWorkPlanArk | UnloadFromVehicleWorkPlanArk | ProvideFromVehicleWorkPlanArk'
		),
	Plan: () => baseGameScope.type('TransferPlan | PickupPlan | WorkPlan | IdlePlan'),
})

// Export base types module for use in other files
export const baseGameTypes = baseGameScope.export()

// Export runtime validators
export const GoodType = baseGameTypes.GoodType
export const TerrainType = baseGameTypes.TerrainType
export const DepositType = baseGameTypes.DepositType
export const AlveolusType = baseGameTypes.AlveolusType
export const JobType = baseGameTypes.JobType
export const ActivityType = baseGameTypes.ActivityType
export const NeedType = baseGameTypes.NeedType
export const Goods = baseGameTypes.Goods
export const Job = baseGameTypes.Job
export const Needs = baseGameTypes.Needs
export const Position = baseGameTypes.Position
export const TransferPlan = baseGameTypes.TransferPlan
export const PickupPlan = baseGameTypes.PickupPlan
export const WorkPlan = baseGameTypes.WorkPlan
export const IdlePlan = baseGameTypes.IdlePlan
export const Plan = baseGameTypes.Plan

// Export TypeScript type aliases (same names, dual export!)
export type GoodType = typeof GoodType.infer
export type TerrainType = typeof TerrainType.infer
export type DepositType = typeof DepositType.infer
export type AlveolusType = typeof AlveolusType.infer
export type JobType = typeof JobType.infer
export type ActivityType = typeof ActivityType.infer
export type NeedType = typeof NeedType.infer
export type Goods = Partial<Record<GoodType, number>>
export type Needs = typeof Needs.infer

// TypeScript interfaces for runtime use (augmented with runtime-only fields)
// These extend the validated plan types with allocation management
export interface TransferPlan<T extends AllocationBase = AllocationBase> {
	readonly type: 'transfer'
	readonly description: 'grab' | 'drop'
	vehicleAllocation?: T // Runtime-only field
	allocation?: T // Runtime-only field
	resolvedGoods?: Goods // Runtime-only field
	readonly goods: Goods
	readonly target?: Positioned
	readonly sourceTile?: Positioned
	invariant?: () => boolean
}

export interface PickupPlan<T extends AllocationBase = AllocationBase> {
	readonly type: 'pickup'
	vehicleAllocation?: T // Runtime-only field
	allocation?: T // Runtime-only field
	readonly goodType: GoodType
	readonly target: Positioned
	releaseStopper?: () => void // Runtime-only field
	invariant?: () => boolean
}

// Job types - returned by alveolus.nextJob()
// Each job type has common fields: job, urgency, fatigue
// TODO: do something with urgency/fatigue?
export interface HarvestJob {
	job: 'harvest'
	urgency: number
	fatigue: number
	path?: Positioned[] // Path to deposit
}

export interface TransformJob {
	job: 'transform'
	urgency: number
	fatigue: number
}

export interface ConveyJob {
	job: 'convey'
	urgency: number
	fatigue: number
}

export interface ConstructJob {
	job: 'construct'
	urgency: number
	fatigue: number
	path?: Positioned[] // Path to construction site
}

/**
 * Planner-visible maintenance offload job. Discriminated by {@link VehicleOffloadJob.maintenanceKind}:
 * - `'loadFromBurden'`: pick up `looseGood` from the burdening tile at `targetCoord`.
 * - `'unloadToTile'`: drop carried stock onto a non-burdening `UnBuiltLand` at `targetCoord`.
 * - `'park'`: drive an empty burdening vehicle onto a non-burdening tile at `targetCoord`.
 *
 * The job carries the minimum hint that `allocateVehicleServiceForJob` needs to construct the
 * matching {@link VehicleMaintenanceService}; runtime scripts then read intent from `vehicle.service`.
 */
export type VehicleOffloadJob = {
	job: 'vehicleOffload'
	urgency: number
	fatigue: number
	vehicleUid: string
	targetCoord: AxialCoord
	/** Distance to claim the wheelbarrow; planner scoring uses this, not the internal vehicle route. */
	approachPath?: AxialCoord[]
	path: AxialCoord[]
} & (
	| { maintenanceKind: 'loadFromBurden'; looseGood: LooseGood }
	| { maintenanceKind: 'unloadToTile' }
	| { maintenanceKind: 'park' }
)

export interface FoundationJob {
	job: 'foundation'
	urgency: number
	fatigue: number
	path?: Positioned[] // Path to site needing foundation
}

export interface DefragmentJob {
	job: 'defragment'
	goodType: GoodType
	urgency: number
	fatigue: number
}

export interface VehicleJob {
	vehicleUid: string
	/** Distance to claim the vehicle before doing vehicle work. */
	approachPath?: AxialCoord[]
}

/** @internal Script/transfer step payloads only; not emitted by the work planner. */
export interface LoadOntoVehicleStepPayload extends VehicleJob {
	job: 'loadOntoVehicle'
	urgency: number
	fatigue: number
	goodType: GoodType
	path: AxialCoord[]
}

/** @internal Script/transfer step payloads only; not emitted by the work planner. */
export interface UnloadFromVehicleStepPayload extends VehicleJob {
	job: 'unloadFromVehicle'
	urgency: number
	fatigue: number
	goodType: GoodType
	quantity: number
	path: AxialCoord[]
}

/** @internal Script/transfer step payloads only; not emitted by the work planner. */
export interface ProvideFromVehicleStepPayload extends VehicleJob {
	job: 'provideFromVehicle'
	urgency: number
	fatigue: number
	goodType: GoodType
	quantity: number
	path: AxialCoord[]
}

/** @internal Unit-test / diagnostics probe; not a planner {@link Job}. */
export interface UnloadFromVehicleProbe extends VehicleJob {
	job: 'unloadFromVehicle'
	urgency: number
	fatigue: number
	goodType: GoodType
	quantity: number
	path: AxialCoord[]
}

export interface VehicleHopJob extends VehicleJob {
	job: 'vehicleHop'
	urgency: number
	fatigue: number
	lineId: string
	stopId: string
	path: AxialCoord[]
	/** True when the hop ends at a freight bay anchor (explicit `walk.enter` to dock at tile center). */
	dockEnter: boolean
	/** Zone hop continuation chosen for the destination stop. */
	zoneBrowseAction?: 'load' | 'provide'
	goodType?: GoodType
	quantity?: number
	targetCoord?: AxialCoord
	adSource?: FreightAdSource
	priorityTier?: FreightPriorityTier
	/** Walk to the vehicle hex before boarding. */
	approachPath?: AxialCoord[]
	/**
	 * When true, the wheelbarrow has no line `service` yet; the script runs the former
	 * `vehicleBeginService` step before hop prepare.
	 */
	needsBeginService?: boolean
}

export interface ZoneBrowseJob extends VehicleJob {
	job: 'zoneBrowse'
	urgency: number
	fatigue: number
	lineId: string
	stopId: string
	path: AxialCoord[]
	zoneBrowseAction: 'load' | 'provide'
	goodType: GoodType
	quantity?: number
	targetCoord: AxialCoord
	adSource: FreightAdSource
	priorityTier: FreightPriorityTier
}

// Job is the union of all job types
export type Job =
	| HarvestJob
	| TransformJob
	| ConveyJob
	| ConstructJob
	| VehicleOffloadJob
	| FoundationJob
	| DefragmentJob
	| VehicleHopJob
	| ZoneBrowseJob

/**
 * Script-internal `type: 'work'` payloads for vehicle transfer primitives.
 * These are **not** {@link Job} values and are not chosen by the planner; NPC scripts and tests
 * construct them while executing `zoneBrowse` / hop flows.
 */
export type LoadOntoVehicleWorkPlan = LoadOntoVehicleStepPayload & {
	readonly type: 'work'
	readonly target: TileContent | any
	invariant?: () => boolean
}

export type UnloadFromVehicleWorkPlan = UnloadFromVehicleStepPayload & {
	readonly type: 'work'
	readonly target: TileContent | any
	invariant?: () => boolean
}

export type ProvideFromVehicleWorkPlan = ProvideFromVehicleStepPayload & {
	readonly type: 'work'
	readonly target: TileContent | any
	invariant?: () => boolean
}

export type WorkPlan =
	| (Exclude<Job, VehicleOffloadJob> & {
			readonly type: 'work'
			readonly target: TileContent | any // Allow Tile or other targets
			offloadPickupPlan?: PickupPlan
			invariant?: () => boolean
			/** Planner walk path to the target; set by {@link Character.workExecution}. */
			path?: AxialCoord[]
			/**
			 * `vehicleHop` only: set when `vehicleHopPrepare` ends line service before travel; the NPC
			 * script skips walk + dock so `vehicleHopDockStep` is not invoked without `vehicle.service`.
			 */
			vehicleHopRunEnded?: boolean
			/**
			 * `vehicleHop` only: `vehicleHopPrepare` changed the active line stop before the tail ran, so
			 * the current script must return and let the planner pick a fresh hop for that new stop.
			 */
			vehicleHopReplanRequired?: boolean
			/**
			 * `vehicleHop` only: after a bay anchor dock, the operator already stepped off while the
			 * vehicle keeps line service; skip `vehicleStepOffKeepingControl` / zone-browse prelude.
			 */
			vehicleHopAnchorDockDisembarked?: boolean
			/** Set when a stale approach reaches a vehicle now operated by another worker. */
			vehicleApproachAborted?: boolean
	  })
	| (VehicleOffloadJob & {
			readonly type: 'work'
			readonly target: TileContent | any
			offloadPickupPlan?: PickupPlan
			invariant?: () => boolean
			path?: AxialCoord[]
			/** Set when a stale approach reaches a vehicle now operated by another worker. */
			vehicleApproachAborted?: boolean
	  })
	| LoadOntoVehicleWorkPlan
	| UnloadFromVehicleWorkPlan
	| ProvideFromVehicleWorkPlan

export interface IdlePlan {
	readonly type: 'idle'
	readonly duration: number
	invariant?: () => boolean
}

export type Plan = TransferPlan | PickupPlan | WorkPlan | IdlePlan
