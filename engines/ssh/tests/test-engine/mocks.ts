import { vi } from 'vitest'

function rulesTestOverrides() {
	return {
		vehicles: {
			'by-hands': { storage: { slots: 10, capacity: 100 }, transferTime: 1 },
			worker: { speed: 1, capacity: 10, transferTime: 1 },
		},
		goods: {
			wood: {
				halfLife: 900,
				massKg: 8,
				baseValueVp: 5,
				tags: ['bulk', 'construction/lumber'],
			},
			stone: {
				halfLife: Number.POSITIVE_INFINITY,
				massKg: 20,
				baseValueVp: 4,
				tags: ['bulk', 'construction/stone'],
			},
			planks: {
				halfLife: 900,
				massKg: 4,
				baseValueVp: 8,
				tags: ['piece', 'construction/lumber'],
			},
			food: {
				satiationStrength: 0.3567,
				halfLife: 600,
				massKg: 1,
				baseValueVp: 1,
				tags: ['food'],
			},
			mushrooms: {
				satiationStrength: Math.LN2,
				halfLife: 600,
				massKg: 1,
				baseValueVp: 3,
				tags: ['food'],
			},
			berries: {
				satiationStrength: 0.3567,
				halfLife: 300,
				massKg: 1,
				baseValueVp: 2,
				tags: ['food'],
			},
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
				workTime: 0,
				action: { type: 'road-fret', kind: 'slotted', capacity: 2, slots: 4 },
				construction: { goods: { wood: 1 }, time: 1 },
			},
			engineer: {
				preparationTime: 1,
				workTime: 2,
				action: { type: 'engineer', radius: 6 },
				construction: { goods: { wood: 1, stone: 1 }, time: 1 },
			},
			engineer_hut: {
				preparationTime: 1,
				workTime: 2,
				action: { type: 'engineer', radius: 6 },
				construction: { goods: { wood: 1, stone: 1 }, time: 1 },
			},
			storage: {
				preparationTime: 1,
				workTime: 0,
				action: { type: 'storage', kind: 'slotted', capacity: 3, slots: 6 },
				// Keep construction needs aligned with gameplay tests that build `storage` sites
				// and expect inbound plank logistics during construction.
				construction: { goods: { wood: 2, planks: 10 }, time: 6 },
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
}

// Vitest only hoists `vi.mock` at module top level. Keeping these inside
// `loadStandardMocks()` registers too late — `engine-rules` can load before overrides apply.
vi.mock('../../assets/resources', () => ({ resources: {}, prefix: '' }))

vi.mock('../../assets/game-content', () => rulesTestOverrides())

vi.mock('engine-rules', async (importOriginal) => {
	const actual = await importOriginal<typeof import('engine-rules')>()
	return { ...actual, ...rulesTestOverrides() }
})

/** No-op hook kept so `TestEngine` can assert setup ran; mocks register on import. */
export function loadStandardMocks() {}
