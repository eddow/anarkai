import type { GamePatches } from './game'

const constructionGoodsSelection = {
	goodRules: [
		{ goodType: 'wood', effect: 'allow' },
		{ goodType: 'planks', effect: 'allow' },
		{ goodType: 'stone', effect: 'allow' },
	],
	tagRules: [],
	defaultEffect: 'deny',
} as const

export const chopSaw = {
	seed: 549,
	terrains: {
		concrete: [
			[10, -8],
			[13, -7],
			[11, -8],
			[11, -7],
			[12, -8],
			[12, -7],
		],
	},
	hives: [
		{
			name: 'ChopSaw',
			alveoli: [
				{ alveolus: 'tree_chopper', coord: [10, -8] },
				{ alveolus: 'stonecutter', coord: [13, -7] },
				{
					alveolus: 'storage',
					coord: [11, -8],
					configuration: {
						ref: { scope: 'individual' },
						individual: {
							working: true,
							generalSlots: 5,
							goods: {
								wood: { minSlots: 1, maxSlots: 0 },
							},
						},
					},
				},
				{ alveolus: 'freight_bay', coord: [11, -7] },
				{ alveolus: 'engineer', coord: [12, -8] },
				{ alveolus: 'sawmill', coord: [12, -7] },
			],
		},
	],
	freightLines: [
		{
			id: 'ChopSaw:implicit-gather:11,-7',
			name: 'ChopSaw (11, -7) gather',
			stops: [
				{
					id: 'ChopSaw:ig-load',
					zone: { kind: 'radius', center: [11, -7], radius: 9 },
				},
				{
					id: 'ChopSaw:ig-unload',
					anchor: {
						kind: 'alveolus',
						hiveName: 'ChopSaw',
						alveolusType: 'freight_bay',
						coord: [11, -7],
					},
				},
			],
		},
		{
			id: 'ChopSaw:distribute:11,-7',
			name: 'ChopSaw (11, -7) distribute',
			stops: [
				{
					id: 'ChopSaw:distribute-load',
					loadSelection: constructionGoodsSelection,
					anchor: {
						kind: 'alveolus',
						hiveName: 'ChopSaw',
						alveolusType: 'freight_bay',
						coord: [11, -7],
					},
				},
				{
					id: 'ChopSaw:distribute-zone',
					zone: { kind: 'radius', center: [11, -7], radius: 9 },
				},
			],
		},
	],
	zones: {
		harvest: [
			[8, -8],
			[8, -7],
			[8, -6],
			[16, -7],
			[16, -8],
		],
		residential: [
			[7, -6],
			[7, -7],
		],
	},
	projects: {
		'build:storage': [
			[9, -7],
			[10, -7],
		],
	},
	vehicles: [
		{
			// TODO: replace uids by indexes in serializations
			uid: 'ChopSaw:wheelbarrow',
			vehicleType: 'wheelbarrow',
			position: { q: 10, r: -6 },
			servedLineIds: ['ChopSaw:implicit-gather:11,-7', 'ChopSaw:distribute:11,-7'],
		},
	],
} satisfies GamePatches

export const dorm = {
	seed: 867,
	terrains: {
		concrete: [
			[0, -1],
			[0, 0],
			[1, 0],
			[0, 1],
			[1, 1],
			[2, 0],
			[3, 0],
			[4, 0],
		],
	},
	hives: [
		{
			name: 'Dorm',
			alveoli: [
				{ alveolus: 'storage', coord: [0, 0], goods: { wood: 8, planks: 4, stone: 4 } },
				{ alveolus: 'engineer', coord: [1, 0] },
				{ alveolus: 'freight_bay', coord: [0, 1] },
				{ alveolus: 'tree_chopper', coord: [0, -1], underConstruction: true },
			],
		},
	],
	freightLines: [
		{
			id: 'Dorm:implicit-gather:0,1',
			name: 'Dorm (0, 1) gather',
			stops: [
				{
					id: 'Dorm:gather-zone',
					loadSelection: constructionGoodsSelection,
					zone: { kind: 'radius', center: [0, 1], radius: 6 },
				},
				{
					id: 'Dorm:gather-unload',
					anchor: {
						kind: 'alveolus',
						hiveName: 'Dorm',
						alveolusType: 'freight_bay',
						coord: [0, 1],
					},
				},
			],
		},
		{
			id: 'Dorm:distribute:0,1',
			name: 'Dorm (0, 1) distribute',
			stops: [
				{
					id: 'Dorm:distribute-load',
					loadSelection: constructionGoodsSelection,
					anchor: {
						kind: 'alveolus',
						hiveName: 'Dorm',
						alveolusType: 'freight_bay',
						coord: [0, 1],
					},
				},
				{
					id: 'Dorm:distribute-zone',
					zone: { kind: 'radius', center: [0, 1], radius: 6 },
				},
			],
		},
	],
	zones: {
		residential: [
			[3, 0],
			[4, 0],
		],
	},
	looseGoods: {
		wood: [[3, 0]],
	},
	vehicles: [
		{
			uid: 'Dorm:wheelbarrow',
			vehicleType: 'wheelbarrow',
			position: { q: 0, r: 1 },
			servedLineIds: ['Dorm:implicit-gather:0,1', 'Dorm:distribute:0,1'],
		},
	],
} satisfies GamePatches

export const saw = {
	seed: 549,
	terrains: {
		concrete: [
			[16, -8],
			[17, -8],
			[18, -8],
			[16, -6],
		],
	},
	hives: [
		{
			name: 'saw',
			alveoli: [
				{ alveolus: 'storage', coord: [16, -8], goods: { wood: 18 } },
				{ alveolus: 'storage', coord: [17, -8], goods: {} },
				{ alveolus: 'sawmill', coord: [18, -8] },
			],
		},
	],
	zones: {
		residential: [[16, -6]],
	},
	looseGoods: {
		berries: [
			[15, -7],
			[15, -7],
			[16, -7],
			[16, -7],
			[15, -6],
		],
		mushrooms: [
			[17, -7],
			[17, -7],
			[17, -6],
		],
	},
} satisfies GamePatches
