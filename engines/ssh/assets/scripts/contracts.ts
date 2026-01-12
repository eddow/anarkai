import type { Contract, ContractType } from '$lib/types'

// Contracts defined using pure string arrays validated by contractScope in arktype.ts
export const CharacterContract = {
	walk: {
		into: ['Position[]'],
		until: ['Position[]'],
	},
	inventory: {
		dropAllFree: [],
		makeRoom: [],
		dropStored: ['Goods', 'Positioned', 'Position[]?', 'boolean?'],
		grabStored: ['Goods', 'Positioned', 'Position[]?', 'boolean?'],
		grabFree: ['GoodType | null', 'Positioned', 'Position[]?', 'boolean?'],
	},
	selfCare: {
		goEat: [],
		wander: [],
	},
	work: {
		goWork: ['WorkPlan', 'Position[]'],
		harvest: ['WorkPlan'],
		convey: ['WorkPlan'],
		offload: ['WorkPlan'],
		gather: ['WorkPlan'],
		transform: ['WorkPlan'],
		construct: ['WorkPlan'],
		foundation: ['WorkPlan'],
		defragment: ['WorkPlan'],
	},
} as const satisfies Contract

export type CharacterContract = ContractType<typeof CharacterContract>
