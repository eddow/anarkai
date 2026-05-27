import { vi } from 'vitest'

function rulesTestOverrides() {
	return {
		vehicles: {
			wheelbarrow: {
				storage: { slots: 10, capacity: 100 },
				transferTime: 1,
				walkTime: 1.45,
				movement: 'offroad',
			},
			pickup_truck: {
				storage: { slots: 2, capacity: 3 },
				transferTime: 1,
				walkTime: 0.85,
				movement: 'road',
			},
			suv: {
				storage: { slots: 1, capacity: 3 },
				transferTime: 1,
				walkTime: 0.85,
				movement: 'offroad',
			},
			worker: { speed: 1, capacity: 10, transferTime: 1 },
		},
		goods: {
			concrete: {
				halfLife: Number.POSITIVE_INFINITY,
				massKg: 12,
				baseValueVp: 10,
				tags: ['bulk', 'construction/concrete'],
			},
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
			wheat: {
				halfLife: 1800,
				massKg: 3,
				baseValueVp: 3,
				tags: ['food', 'grain'],
			},
			flour: {
				halfLife: 1600,
				massKg: 2,
				baseValueVp: 5,
				tags: ['food', 'grain', 'prepared-food'],
			},
			bread: {
				satiationStrength: 0.82,
				halfLife: 900,
				massKg: 1,
				baseValueVp: 7,
				tags: ['food', 'prepared-food'],
			},
			sandwich: {
				satiationStrength: 1.05,
				halfLife: 900,
				massKg: 1,
				baseValueVp: 8,
				tags: ['food', 'prepared-food'],
			},
			clothes: {
				halfLife: 2400,
				massKg: 2,
				baseValueVp: 12,
				tags: ['piece', 'personal-goods'],
			},
			sunglasses: {
				halfLife: 3600,
				massKg: 1,
				baseValueVp: 10,
				tags: ['piece', 'personal-goods'],
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
		deposits: {
			tree: { maxAmount: 12, regenerate: 0.01, generation: { mushrooms: 0.000097 } },
			rock: { maxAmount: 18 },
			berry_bush: { maxAmount: 18, regenerate: 0.01, generation: { berries: 0.000214 } },
			wheat_crop: { maxAmount: 18 },
		},
		alveoli: {
			forester: {
				preparationTime: 1,
				workTime: 1,
				action: { type: 'plant', deposit: 'tree' },
				construction: { goods: { wood: 1 }, time: 1 },
			},
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
					rates: { wood: -0.2, planks: 0.2 },
					productRatio: { inputGood: 'wood', outputGood: 'planks', maxProductRatio: 0.5 },
				},
				construction: { goods: { wood: 1 }, time: 1 },
			},
			wheat_planter: {
				preparationTime: 1,
				workTime: 1,
				action: { type: 'plant', deposit: 'wheat_crop' },
				construction: { goods: { wood: 1 }, time: 1 },
			},
			wheat_harvester: {
				preparationTime: 1,
				workTime: 2,
				action: { type: 'harvest', deposit: 'wheat_crop', output: { wheat: 1 } },
				construction: { goods: { wood: 1 }, time: 1 },
			},
			flour_mill: {
				preparationTime: 1,
				workTime: 2,
				action: {
					type: 'transform',
					rates: { wheat: -0.2, flour: 0.2 },
					productRatio: { inputGood: 'wheat', outputGood: 'flour', maxProductRatio: 0.6 },
				},
				construction: { goods: { wood: 1 }, time: 1 },
			},
			bakery: {
				preparationTime: 1,
				workTime: 2,
				action: {
					type: 'transform',
					rates: { flour: -0.15, bread: 0.15 },
					productRatio: { inputGood: 'flour', outputGood: 'bread', maxProductRatio: 0.7 },
				},
				construction: { goods: { wood: 1 }, time: 1 },
			},
			restaurant: {
				preparationTime: 1,
				workTime: 2,
				action: {
					type: 'transform',
					rates: { berries: -0.1, mushrooms: -0.1, sandwich: 0.1 },
					productRatio: { inputGood: 'berries', outputGood: 'sandwich', maxProductRatio: 0.65 },
				},
				construction: { goods: { wood: 1 }, time: 1 },
			},
			stonecutter: {
				preparationTime: 1,
				workTime: 2,
				action: {
					type: 'transform',
					rates: { stone: -0.2 },
				},
				construction: { goods: { wood: 1 }, time: 1 },
			},
			freight_bay: {
				preparationTime: 1,
				workTime: 0,
				action: { type: 'road-fret' },
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
			priorityTier: {
				lineAndOffloadJoint: 1.35,
				pureOffload: 1.1,
				pureLine: 1,
			},
			offload: {
				projectTile: 30,
				alveolusBlocked: 25,
				residentialTile: 21,
				unloadToTile: 8,
				park: 17,
			},
			convey: 3,
			gather: 2.5,
			harvest: {
				clearing: 2.5,
				fallbackBase: 0.25,
				needsBonus: 0.5,
			},
			transform: 1,
			forester: 1.2,
			engineer: {
				foundation: 3,
				construct: 2,
			},
			defragment: 0.9,
			vehicleApproach: 2,
			vehicleBeginService: 2.07,
			loadOntoVehicle: 2.15,
			unloadFromVehicle: 2.16,
			provideFromVehicle: 2.25,
			vehicleHop: 2.1,
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
			transform: {
				working: true,
				productRatio: undefined,
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
