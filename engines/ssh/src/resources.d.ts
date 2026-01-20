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
	interface GatherAction {
		type: 'gather'
		radius: number
	}
	interface EngineerAction {
		type: 'engineer'
		radius: number
	}
	interface SlottedStorageAction extends SlottedStorage {
		type: 'slotted-storage'
	}
	interface SpecificStorageAction {
		type: 'specific-storage'
		goods: SpecificStorage
		// TODO: Buffers are not specified in the action (game content) but in the alveolus (alveolus-configuration)
		buffers?: Record<string, number>
	}
	type StorageAction = SlottedStorageAction | SpecificStorageAction

	type Action =
		| HarvestingAction
		| TransformationAction
		| GatherAction
		| EngineerAction
		| StorageAction

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

	/** Union of all configuration types */
	type AlveolusConfiguration = BaseAlveolusConfiguration | SpecificStorageAlveolusConfiguration

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
		feedingValue?: number
		halfLife: number
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

	type ActivityType = 'idle' | 'walk' | 'work' | 'eat' | 'sleep' | 'rest' | 'convey' | 'gather'

	type NeedType = 'hunger' | 'tiredness' | 'fatigue'
}
