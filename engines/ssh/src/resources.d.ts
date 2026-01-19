declare namespace Ssh {
	interface SlottedStorage {
		capacity: number
		slots: number
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
	}
	type StorageAction = SlottedStorageAction | SpecificStorageAction

	type Action =
		| HarvestingAction
		| TransformationAction
		| GatherAction
		| EngineerAction
		| StorageAction

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
