import type { Contract, ContractType } from 'ssh/types'

// Contracts defined using pure string arrays validated by contractScope in arktype.ts
export const CharacterContract = {
	walk: {
		into: ['Position[]'],
		until: ['Position[]'],
	},
	inventory: {
		dropAllLoose: [],
		makeRoom: [],
		dropStored: ['Goods', 'Positioned', 'Position[]?', 'boolean?'],
		grabStored: ['Goods', 'Positioned', 'Position[]?', 'boolean?'],
		grabLoose: ['GoodType | null', 'Positioned', 'Position[]?', 'boolean?'],
	},
	selfCare: {
		goEat: [],
		goHome: [],
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
