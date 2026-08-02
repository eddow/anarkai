import { residentialBasicDwellingProject } from '../residential/constants'
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
				{ alveolus: 'forester', coord: [2, -1], assignedZoneIndices: [2] },
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
				{ alveolus: 'engineer', coord: [1, -1], variant: 'building' },
				{ alveolus: 'sawmill', coord: [1, 0] },
			],
		},
	],
	freightLines: [
		{
			name: 'ChopSaw (0, 0) gather',
			cyclic: true,
			stops: [
				{
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
					loadSelection: constructionGoodsSelection,
					unloadSelection: constructionGoodsSelection,
					zone: { kind: 'radius', center: [0, 0], radius: 9 },
				},
			],
		},
		{
			name: 'ChopSaw (0, 0) distribute',
			cyclic: true,
			stops: [
				{
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
					loadSelection: concreteOnlySelection,
					unloadSelection: planksOnlySelection,
					trade: { kind: 'settlement', settlementId: 'settlement-7,19', profile: undefined! },
				},
			],
		},
	],
	zones: [
		{
			type: 'harvest',
			coords: [
				[4, 1],
				[3, 2],
				[3, 3],
				[-4, 2],
				[-5, 2],
			],
		},
		{
			type: 'residential',
			coords: [
				[-4, 1],
				[-4, 0],
			],
		},
		{
			name: 'North Grove',
			color: '#3f9f6b',
			type: 'harvest',
			coords: [
				[3, 0],
				[4, 0],
				[5, 0],
			],
		},
	],
	projects: {
		'build:pile.planks': [[-1, 0]],
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
			name: 'ChopSaw:wheelbarrow1',
			vehicleType: 'wheelbarrow',
			position: { q: -1, r: 1 },
			// Bootstrap order: implicit gather, then explicit gather, then distribute.
			servedLineIndices: [1],
		},
		{
			name: 'ChopSaw:wheelbarrow2',
			vehicleType: 'wheelbarrow',
			position: { q: -1, r: 2 },
			servedLineIndices: [1],
		},
		{
			name: 'ChopSaw:wheelbarrow3',
			vehicleType: 'wheelbarrow',
			position: { q: -2, r: 2 },
			servedLineIndices: [1],
		},
		{
			name: 'ChopSaw:suv',
			vehicleType: 'suv',
			position: { q: 0, r: 0 },
			servedLineIndices: [2],
		},
	],
} satisfies GamePatches

export const demoHive = {
	seed: 549,
	terrains: {
		concrete: [
			[-1, 0],
			[0, 0],
			[0, 1],
			[1, -1],
			[1, 0],
			[2, -1],
			[2, 0],
			[-4, 1],
			[-3, 1],
		],
		forest: [
			[3, -1],
			[4, -1],
			[4, 0],
			[5, -1],
		],
	},
	hives: [
		{
			name: 'HearthLoop',
			alveoli: [
				{
					alveolus: 'storage',
					coord: [0, 0],
					goods: { wood: 4, planks: 3, stone: 2, concrete: 1 },
					configuration: {
						ref: { scope: 'individual' },
						individual: {
							working: true,
							generalSlots: 6,
							goods: {
								concrete: { minSlots: 1, maxSlots: 2 },
								wood: { minSlots: 1, maxSlots: 3 },
								planks: { minSlots: 1, maxSlots: 3 },
								stone: { minSlots: 1, maxSlots: 2 },
							},
						},
					},
				},
				{ alveolus: 'freight_bay', coord: [0, 1] },
				{ alveolus: 'engineer', coord: [1, -1] },
				{ alveolus: 'sawmill', coord: [1, 0] },
				{ alveolus: 'tree_chopper', coord: [2, 0] },
				{ alveolus: 'forester', coord: [2, -1], assignedZoneIndices: [2] },
				{ alveolus: 'stonecutter', coord: [-1, 0] },
			],
		},
	],
	freightLines: [
		{
			name: 'HearthLoop commons exchange',
			cyclic: true,
			stops: [
				{
					loadSelection: constructionGoodsSelection,
					unloadSelection: constructionGoodsSelection,
					anchor: {
						kind: 'alveolus',
						hiveName: 'HearthLoop',
						alveolusType: 'freight_bay',
						coord: [0, 1],
					},
				},
				{
					loadSelection: constructionGoodsSelection,
					unloadSelection: constructionGoodsSelection,
					zone: { kind: 'radius', center: [0, 1], radius: 8 },
				},
			],
		},
		{
			name: 'HearthLoop - Melindbury comfort loop',
			cyclic: true,
			stops: [
				{
					loadSelection: planksOnlySelection,
					unloadSelection: concreteOnlySelection,
					anchor: {
						kind: 'alveolus',
						hiveName: 'HearthLoop',
						alveolusType: 'freight_bay',
						coord: [0, 1],
					},
				},
				{
					loadSelection: concreteOnlySelection,
					unloadSelection: planksOnlySelection,
					trade: { kind: 'settlement', settlementId: 'settlement-7,19', profile: undefined! },
				},
			],
		},
	],
	zones: [
		{
			type: 'harvest',
			coords: [
				[3, -1],
				[4, -1],
				[4, 0],
			],
		},
		{
			type: 'residential',
			coords: [
				[-4, 1],
				[-3, 1],
				[-4, 2],
				[-3, 2],
			],
		},
		{
			type: 'commercial',
			coords: [
				[-5, 1],
				[-5, 2],
			],
		},
		{
			name: 'Green Ring',
			color: '#3f9f6b',
			type: 'harvest',
			coords: [
				[3, -1],
				[4, -1],
				[4, 0],
				[5, -1],
			],
		},
	],
	dwellings: [{ coord: [-4, 1], tier: 'basic_dwelling' }],
	projectSites: [
		{
			coord: [-3, 1],
			project: residentialBasicDwellingProject,
			constructionPhase: 'waiting_materials',
			foundationConsumedGoods: { concrete: 1 },
			constructionGoods: { wood: 1 },
		},
	],
	looseGoods: {
		wood: [
			[3, -1],
			[4, -1],
		],
		stone: [[-2, 0]],
	},
	roads: {
		path: [
			[-0.5, 1],
			[-1.5, 1],
			[-2.5, 1],
			[-3.5, 1],
			[0.5, 1],
			[1.5, 1],
			[2.5, 0.5],
		],
	},
	playerAccount: { balanceVp: 120 },
	vehicles: [
		{
			name: 'HearthLoop:wheelbarrow',
			vehicleType: 'wheelbarrow',
			position: { q: 0, r: 1 },
			// Bootstrap order: implicit gather, commons exchange, comfort loop.
			servedLineIndices: [1],
		},
		{
			name: 'HearthLoop:pickup-truck',
			vehicleType: 'pickup_truck',
			position: { q: 0, r: 1 },
			servedLineIndices: [2],
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
			],
		},
	],
	freightLines: [
		{
			name: 'Dorm (0, 1) exchange',
			cyclic: true,
			stops: [
				{
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
					loadSelection: constructionGoodsSelection,
					unloadSelection: constructionGoodsSelection,
					zone: { kind: 'radius', center: [0, 1], radius: 6 },
				},
			],
		},
	],
	zones: [
		{
			type: 'residential',
			coords: [
				[3, 0],
				[4, 0],
			],
		},
	],
	projectSites: [
		{
			coord: [0, -1],
			project: 'build:tree_chopper',
			constructionPhase: 'waiting_materials',
			constructionGoods: {},
		},
	],
	looseGoods: {
		wood: [[3, 0]],
	},
	vehicles: [
		{
			name: 'Dorm:wheelbarrow',
			vehicleType: 'wheelbarrow',
			position: { q: 0, r: 1 },
			// Bootstrap order: implicit gather first, then explicit exchange.
			servedLineIndices: [0],
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
	zones: [{ type: 'residential', coords: [[16, -6]] }],
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
