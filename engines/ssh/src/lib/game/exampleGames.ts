import type { GamePatches } from './game'

const constructionGoodsSelection = {
	goodRules: [
		{ goodType: 'concrete', effect: 'allow' },
		{ goodType: 'wood', effect: 'allow' },
		{ goodType: 'planks', effect: 'allow' },
		{ goodType: 'stone', effect: 'allow' },
	],
	tagRules: [],
	defaultEffect: 'deny',
} as const

const concreteOnlySelection = {
	goodRules: [{ goodType: 'concrete', effect: 'allow' }],
	tagRules: [],
	defaultEffect: 'deny',
} as const

const planksOnlySelection = {
	goodRules: [{ goodType: 'planks', effect: 'allow' }],
	tagRules: [],
	defaultEffect: 'deny',
} as const

export const chopSaw = {
	seed: 549,
	terrains: {
		concrete: [
			[-1, -1],
			[2, 0],
			[0, -1],
			[0, 0],
			[1, -1],
			[1, 0],
			[2, -1],
		],
		forest: [
			[3, 0],
			[4, 0],
			[5, 0],
		],
	},
	hives: [
		{
			name: 'ChopSaw',
			alveoli: [
				{ alveolus: 'stonecutter', coord: [-1, -1] },
				{ alveolus: 'tree_chopper', coord: [2, 0] },
				{ alveolus: 'forester', coord: [2, -1], assignedZoneIds: ['north-grove'] },
				{
					alveolus: 'storage',
					coord: [0, -1],
					configuration: {
						ref: { scope: 'individual' },
						individual: {
							working: true,
							generalSlots: 5,
							goods: {
								concrete: { minSlots: 1, maxSlots: 2 },
								wood: { minSlots: 1, maxSlots: 2 },
								planks: { minSlots: 1, maxSlots: 2 },
								stone: { minSlots: 1, maxSlots: 2 },
							},
						},
					},
				},
				{ alveolus: 'freight_bay', coord: [0, 0] },
				{ alveolus: 'engineer', coord: [1, -1] },
				{ alveolus: 'sawmill', coord: [1, 0] },
			],
		},
	],
	freightLines: [
		{
			id: 'ChopSaw:implicit-gather:0,0',
			name: 'ChopSaw (0, 0) exchange',
			cyclic: true,
			stops: [
				{
					id: 'ChopSaw:ig-unload',
					loadSelection: constructionGoodsSelection,
					unloadSelection: constructionGoodsSelection,
					anchor: {
						kind: 'alveolus',
						hiveName: 'ChopSaw',
						alveolusType: 'freight_bay',
						coord: [0, 0],
					},
				},
				{
					id: 'ChopSaw:ig-load',
					loadSelection: constructionGoodsSelection,
					unloadSelection: constructionGoodsSelection,
					zone: { kind: 'radius', center: [0, 0], radius: 9 },
				},
			],
		},
		{
			id: 'ChopSaw:materials-loop:0,0:Melindbury',
			name: 'ChopSaw - Melindbury materials',
			cyclic: true,
			stops: [
				{
					id: 'ChopSaw:materials-bay',
					loadSelection: planksOnlySelection,
					unloadSelection: concreteOnlySelection,
					anchor: {
						kind: 'alveolus',
						hiveName: 'ChopSaw',
						alveolusType: 'freight_bay',
						coord: [0, 0],
					},
				},
				{
					id: 'ChopSaw:materials-melindbury',
					loadSelection: concreteOnlySelection,
					unloadSelection: planksOnlySelection,
					trade: { kind: 'settlement', settlementId: 'settlement-7,19' },
				},
			],
		},
	],
	zones: {
		harvest: [
			[4, 1],
			[3, 2],
			[3, 3],
			[-4, 2],
			[-5, 2],
		],
		residential: [
			[-4, 1],
			[-4, 0],
		],
		named: [
			{
				id: 'north-grove',
				name: 'North Grove',
				color: '#3f9f6b',
				harvestable: true,
				coords: [
					[3, 0],
					[4, 0],
					[5, 0],
				],
			},
		],
	},
	districts: [
		{
			id: 'default',
			name: 'Default district',
			kind: 'mixed',
			members: [
				[-1, -1],
				[2, 0],
				[0, -1],
				[0, 0],
				[1, -1],
				[1, 0],
				[2, -1],
				[-1, 0],
				[3, 0],
				[4, 0],
				[5, 0],
				[4, 1],
				[3, 2],
				[3, 3],
				[-4, 2],
				[-5, 2],
				[-4, 1],
				[-4, 0],
			],
		},
	],
	projects: {
		'build:storage': [[-1, 0]],
	},
	roads: {
		path: [
			[-2.5, 1],
			[-1.5, 1],
			[-0.5, 1],
			[-0.5, 0.5],
			[0.5, 1],
		],
	},
	vehicles: [
		{
			// TODO: replace uids by indexes in serializations
			uid: 'ChopSaw:wheelbarrow',
			vehicleType: 'wheelbarrow',
			position: { q: -1, r: 1 },
			servedLineIds: ['ChopSaw:implicit-gather:0,0'],
		},
		{
			uid: 'ChopSaw:pickup-truck',
			vehicleType: 'pickup_truck',
			position: { q: 0, r: 0 },
			servedLineIds: ['ChopSaw:materials-loop:0,0:Melindbury'],
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
			name: 'Dorm (0, 1) exchange',
			cyclic: true,
			stops: [
				{
					id: 'Dorm:gather-unload',
					loadSelection: constructionGoodsSelection,
					unloadSelection: constructionGoodsSelection,
					anchor: {
						kind: 'alveolus',
						hiveName: 'Dorm',
						alveolusType: 'freight_bay',
						coord: [0, 1],
					},
				},
				{
					id: 'Dorm:gather-zone',
					loadSelection: constructionGoodsSelection,
					unloadSelection: constructionGoodsSelection,
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
			servedLineIds: ['Dorm:implicit-gather:0,1'],
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
