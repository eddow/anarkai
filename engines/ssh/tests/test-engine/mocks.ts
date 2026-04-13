import { vi } from 'vitest'

export function loadStandardMocks() {
	// Mock $assets/resources
	vi.mock('../../assets/resources', () => ({ resources: {}, prefix: '' }))

	// Mock $assets/game-content
	vi.mock('../../assets/game-content', () => {
		return {
			vehicles: {
				'by-hands': { storage: { slots: 10, capacity: 100 }, transferTime: 1 },
				worker: { speed: 1, capacity: 10, transferTime: 1 },
			},
			goods: {
				wood: { halfLife: 900 },
				stone: { halfLife: Number.POSITIVE_INFINITY },
				planks: { halfLife: 900 },
				food: { satiationStrength: 0.3567, halfLife: 600 },
				mushrooms: { satiationStrength: Math.LN2, halfLife: 600 },
				berries: { satiationStrength: 0.3567, halfLife: 300 },
			},
			terrain: new Proxy(
				{},
				{
					get: () => ({
						walkTime: 1,
						generation: { deposits: {} },
						sprites: ['grass.png'],
					}),
				}
			),
			deposits: { tree: { generation: {}, maxAmount: 100 } },
			alveoli: {
				tree_chopper: {
					preparationTime: 1,
					workTime: 2,
					action: { type: 'harvest', deposit: 'tree', output: { wood: 1 } },
					construction: { goods: { stone: 1 }, time: 1 },
				},
				sawmill: {
					preparationTime: 1,
					workTime: 2,
					action: {
						type: 'transform',
						inputs: { wood: 1 },
						output: { planks: 1 },
					},
					construction: { goods: { wood: 1 }, time: 1 },
				},
				freight_bay: {
					preparationTime: 1,
					workTime: 2,
					action: { type: 'gather' },
					construction: { goods: { wood: 1 }, time: 1 },
				},
				engineer_hut: {
					preparationTime: 1,
					workTime: 2,
					action: { type: 'engineer', radius: 6 },
					construction: { goods: { wood: 1 }, time: 1 },
				},
				storage: {
					preparationTime: 1,
					workTime: 0,
					action: { type: 'storage', kind: 'slotted', capacity: 3, slots: 6 },
					construction: { goods: { wood: 2 }, time: 6 },
				},
				woodpile: {
					preparationTime: 1,
					workTime: 0,
					action: { type: 'storage', kind: 'specific', goods: { wood: 24 } },
					construction: { goods: { wood: 10 }, time: 4 },
				},
			},
			jobBalance: {
				offload: {
					projectTile: 15,
					alveolusBlocked: 4,
					residentialTile: 1.25,
				},
				convey: 3,
				gather: 2.5,
				harvest: {
					clearing: 2.5,
					fallbackBase: 0.25,
					needsBonus: 0.5,
				},
				transform: 1,
				engineer: {
					foundation: 3,
					construct: 2,
				},
				defragment: 0.9,
			},
			configurations: {
				'slotted-storage': {
					working: true,
					generalSlots: 0,
					goods: {},
				},
				'specific-storage': {
					working: true,
					buffers: {},
				},
				default: {
					working: true,
				},
			},
		}
	})
}
