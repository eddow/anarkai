declare namespace Ssh {
	interface SlottedStorage {
		capacity: number
		slots: number
		// TODO: Buffers are not specified in the action (game content) but in the alveolus (alveolus-configuration)
		buffers?: Record<string, number>
	}
	interface SpecificStorage {
		[goodType: string]: number
	}
	type StorageSpec = SlottedStorage | SpecificStorage
	interface DepositDefinition {
		maxAmount: number
		regenerate?: number
		generation?: Record<string, number>
	}

	interface HarvestingAction {
		type: 'harvest'
		deposit: string
		output: Record<string, number>
	}

	interface TransformationAction {
		type: 'transform'
		inputs: Record<string, number>
		output: Record<string, number>
	}
	interface EngineerAction {
		type: 'engineer'
		radius: number
	}
	type StorageKind = 'slotted' | 'specific'

	interface SlottedStorageAction extends SlottedStorage {
		type: 'slotted-storage'
	}
	interface SpecificStorageAction {
		type: 'specific-storage'
		goods: SpecificStorage
		// TODO: Buffers are not specified in the action (game content) but in the alveolus (alveolus-configuration)
		buffers?: Record<string, number>
	}

	/** Unified storage building: role is `storage`, layout is `kind`. */
	interface UnifiedSlottedStorageAction extends SlottedStorage {
		type: 'storage'
		kind: 'slotted'
	}
	interface UnifiedSpecificStorageAction {
		type: 'storage'
		kind: 'specific'
		goods: SpecificStorage
		buffers?: Record<string, number>
	}

	/** Roadside freight stop: same storage layouts as `storage`, transport-facing role. */
	interface RoadFretSlottedAction extends SlottedStorage {
		type: 'road-fret'
		kind: 'slotted'
	}
	interface RoadFretSpecificAction {
		type: 'road-fret'
		kind: 'specific'
		goods: SpecificStorage
		buffers?: Record<string, number>
	}

	type LegacyStorageAction = SlottedStorageAction | SpecificStorageAction
	type UnifiedStorageAction = UnifiedSlottedStorageAction | UnifiedSpecificStorageAction
	type RoadFretAction = RoadFretSlottedAction | RoadFretSpecificAction
	/** Any alveolus action that backs a {@link StorageAlveolus} instance. */
	type AlveolusStorageAction = LegacyStorageAction | UnifiedStorageAction | RoadFretAction
	type StorageAction = LegacyStorageAction | UnifiedStorageAction

	type Action =
		| HarvestingAction
		| TransformationAction
		| EngineerAction
		| StorageAction
		| RoadFretAction

	/**
	 * Configuration scope determines where the configuration is stored and resolved from.
	 * Priority order: individual > named > hive > default
	 */
	type ConfigurationScope = 'individual' | 'hive' | 'named'

	/**
	 * Reference to a configuration. Used by alveoli to specify which configuration to use.
	 */
	interface ConfigurationReference {
		scope: ConfigurationScope
		/** Required when scope is 'named' - the name of the global configuration */
		name?: string
	}

	/**
	 * Base configuration for all alveoli types.
	 * Can be extended by specific alveolus types.
	 */
	interface BaseAlveolusConfiguration {
		working: boolean
	}

	/**
	 * Configuration specific to specific-storage alveoli.
	 * Extends base with buffer settings.
	 */
	interface SpecificStorageAlveolusConfiguration extends BaseAlveolusConfiguration {
		/** Buffer amounts per good type - when stock is below buffer, demand priority is elevated */
		buffers: Record<string, number>
	}

	interface SlottedStorageGoodConfiguration {
		minSlots: number
		maxSlots: number
	}

	/**
	 * Configuration specific to slotted-storage alveoli.
	 * `generalSlots` limits how many non-configured goods may occupy slots.
	 */
	interface SlottedStorageAlveolusConfiguration extends BaseAlveolusConfiguration {
		generalSlots: number
		goods: Record<string, SlottedStorageGoodConfiguration>
	}

	type StorageAlveolusConfiguration =
		| SpecificStorageAlveolusConfiguration
		| SlottedStorageAlveolusConfiguration

	/** Union of all configuration types */
	type AlveolusConfiguration = BaseAlveolusConfiguration | StorageAlveolusConfiguration

	interface AlveolusDefinition<ActionType extends Action = Action> {
		preparationTime: number
		action: ActionType
		workTime: number
		construction?: {
			goods: Record<string, number>
			time: number
		}
	}
	interface GoodsDefinition {
		satiationStrength?: number
		halfLife: number
		/** Integer mass in kilograms for logistics and balancing. */
		massKg?: number
		/** Integer trade hint in abstract value points (smallest indivisible unit). */
		baseValueVp?: number
		/** Slash-separated hierarchical tags, e.g. `liquid/water`, `temperature/chilled`. */
		tags?: readonly string[]
	}

	interface VehicleDefinition {
		storage: StorageSpec
		walkTime: number
		transferTime: number
	}
	interface TerrainDefinition {
		generation?: {
			deposits?: Record<string, number>
			goods?: Record<string, number>
		}
	}

	type ActivityType = 'idle' | 'walk' | 'work' | 'eat' | 'sleep' | 'rest' | 'convey'

	type NeedType = 'hunger' | 'tiredness' | 'fatigue'
}
