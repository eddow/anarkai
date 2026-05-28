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

	interface PlantingAction {
		type: 'plant'
		deposit: string
	}

	interface TransformationAction {
		type: 'transform'
		rates: Record<string, number>
		productRatio?: TransformProductRatioConfiguration
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

	/** Roadside freight stop: dock/portal only; cargo lives in docked vehicles or real storage. */
	interface RoadFretAction {
		type: 'road-fret'
	}

	type LegacyStorageAction = SlottedStorageAction | SpecificStorageAction
	type UnifiedStorageAction = UnifiedSlottedStorageAction | UnifiedSpecificStorageAction
	/** Any alveolus action that backs a {@link StorageAlveolus} instance. */
	type AlveolusStorageAction = LegacyStorageAction | UnifiedStorageAction
	type StorageAction = LegacyStorageAction | UnifiedStorageAction

	type Action =
		| HarvestingAction
		| PlantingAction
		| TransformationAction
		| EngineerAction
		| StorageAction
		| RoadFretAction

	/** Engineering specialization for engineer alveolus variants. */
	type EngineeringSpec =
		| { kind: 'building' }
		| { kind: 'research' }
		| { kind: 'road' }
		| { kind: 'construct-foundation' }

	/** Definition for an alveolus variant nested under a root type. */
	interface AlveolusVariantDefinition {
		/** Override the root action when this variant is active. */
		action?: Action
		/** Construction recipe for reaching this variant state from its parent. */
		construction?: {
			goods: Record<string, number>
			time: number
		}
		/** Engineering specialization (engineer variants only). */
		spec?: EngineeringSpec
		/** Nested sub-variants. */
		variants?: Record<string, AlveolusVariantDefinition>
	}

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

	interface TransformProductRatioConfiguration {
		inputGood?: string
		outputGood?: string
		maxProductRatio: number
	}

	interface TransformAlveolusConfiguration extends BaseAlveolusConfiguration {
		productRatio?: TransformProductRatioConfiguration
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
	type AlveolusConfiguration =
		| BaseAlveolusConfiguration
		| TransformAlveolusConfiguration
		| StorageAlveolusConfiguration

	interface AlveolusDefinition<ActionType extends Action = Action> {
		preparationTime: number
		action: ActionType
		workTime: number
		construction?: {
			goods: Record<string, number>
			time: number
		}
		/** Nested variant definitions (e.g., pile.wood, pile.wood.extra). */
		variants?: Record<string, AlveolusVariantDefinition>
		/** Engineering specialization for the root (only used by `engineer` type). */
		spec?: EngineeringSpec
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
		movement?: 'road' | 'offroad'
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
