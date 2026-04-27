import type { Contract, ContractType } from 'ssh/types'

// Contracts defined using pure string arrays validated by contractScope in arktype.ts
// List of functions (scripts) that are defined *in the npcs* - the contracts defined in ts (steps, ...) are defined there, no need for them here.
export const CharacterContract = {
	walk: {
		into: ['Position[]'],
		until: ['Position[]'],
		untilTileBorder: ['Position[]'],
		stepUntilGood: ['Positioned'],
	},
	selfCare: {
		goEat: [],
		goHome: [],
		wander: [],
		eatFromWorld: ['GoodType', 'Tile'],
	},
	work: {
		goWork: ['WorkPlan'],
		harvest: ['WorkPlan'],
		convey: ['WorkPlan'],
		vehicleOffload: ['WorkPlan'],
		transform: ['WorkPlan'],
		construct: ['WorkPlan'],
		foundation: ['WorkPlan'],
		defragment: ['WorkPlan'],
		vehicleHop: ['WorkPlan'],
		zoneBrowse: ['WorkPlan'],
		ensureVehicleOffloadPickupPlan: ['WorkPlan'],
	},
	vehicle: {
		vehicleHop: ['WorkPlan'],
		zoneBrowse: ['WorkPlan'],
		vehicleOffload: ['WorkPlan'],
		maintenanceKind: [],
		completeVehicleMaintenanceService: ['WorkPlan'],
		abandonVehicleMaintenanceService: ['WorkPlan'],
		endParkingService: [],
	},
} as const satisfies Contract

export type CharacterContract = ContractType<typeof CharacterContract>
