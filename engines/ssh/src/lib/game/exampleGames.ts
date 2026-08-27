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

const woodOnlySelection = {
	goodRules: [{ goodType: 'wood', effect: 'allow' }],
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
					trade: { kind: 'settlement', center: { q: 7, r: 19 }, profile: undefined! },
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
			// Explicit line order: gather (index 0), distribute (index 1).
			servedLineIndices: [0],
		},
		{
			name: 'ChopSaw:wheelbarrow2',
			vehicleType: 'wheelbarrow',
			position: { q: -1, r: 2 },
			servedLineIndices: [0],
		},
		{
			name: 'ChopSaw:wheelbarrow3',
			vehicleType: 'wheelbarrow',
			position: { q: -2, r: 2 },
			servedLineIndices: [0],
		},
		{
			name: 'ChopSaw:suv',
			vehicleType: 'suv',
			position: { q: 0, r: 0 },
			servedLineIndices: [1],
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
				{ alveolus: 'forester', coord: [2, -1], assignedZoneIndices: [3] },
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
					trade: { kind: 'settlement', center: { q: 7, r: 19 }, profile: undefined! },
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
			// Explicit line order: commons exchange (index 0), comfort loop (index 1).
			servedLineIndices: [0],
		},
		{
			name: 'HearthLoop:pickup-truck',
			vehicleType: 'pickup_truck',
			position: { q: 0, r: 1 },
			servedLineIndices: [1],
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
			name: 'Dorm (0, 1) gather',
			cyclic: true,
			stops: [
				{
					zone: { kind: 'radius', center: [0, 1], radius: 9 },
				},
				{
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
			// Explicit line order: gather (index 0), exchange (index 1).
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

/** Axis-aligned (in axial q,r) rectangular block of coords, both bounds inclusive. */
function axialRect(q0: number, q1: number, r0: number, r1: number): readonly [number, number][] {
	const coords: [number, number][] = []
	for (let q = Math.min(q0, q1); q <= Math.max(q0, q1); q++) {
		for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) {
			coords.push([q, r])
		}
	}
	return coords
}

// Two parallelogram zones below the hives — residential (east) beside commercial (west),
// separated by a vertical road running down the gap column (q = -1).
const commonsResidential = axialRect(0, 3, 2, 6)
const commonsCommercial = axialRect(-5, -2, 2, 6)
const commonsGroveWood = axialRect(1, 4, -5, -4)
const commonsGap = axialRect(-1, -1, 2, 6)

/**
 * The commerce starting point: several **unitary hives** (each a minimal, separate
 * production loop with its own freight bay) rather than one complex hive, plus a
 * residential zone and a commercial zone laid out **below** the hives as two
 * parallelograms side by side (residential east, commercial west), and a first
 * construction project. Unlike `chopSaw` (one big hive), each hive here is a small
 * building cluster with its own delivery tile (freight bay).
 *
 *   - Grove  (forestry):   chopper + forester + wood pile   → produces wood
 *   - Mill   (sawmill):    2 sawmills + wood/plank piles    → wood → planks
 *   - Quarry (stone):      stonecutter + stone pile         → produces stone
 *   - Depot  (infrastructure): slotted storages + building/road engineers
 *
 * Layout rules honoured:
 *   - every hive and zone is separated from its neighbours by ≥1 empty tile;
 *   - **no loose goods or generated deposits sit on used tiles** (residential /
 *     commercial / hive) — the zones and road corridor are `concrete` (empty
 *     generation), and explicit `looseGoods` live only in the forest, so the
 *     gather route never triggers a gamestart offload;
 *   - the wood zone (`Grove Wood`) has **no road**; a single road runs **between the
 *     residential and commercial zones** as their separator, never through the wood;
 *   - the **Depot sits west of the settlements** (leftmost hive), clear of the water.
 *
 * **Inputs are buffered; output piles are "drain-me".** The chopper and stonecutter
 * shed their output into an output pile (Grove wood, Quarry stone) that the gather and
 * transport lines pick from — those piles stay buffer-less so they always release their
 * stock. The **Depot** is the construction-materials buffer: its slotted storages keep
 * a small keep-target (≈5 units) of each of wood/planks/stone/concrete for the
 * engineers. The **Mill** buffers its *input* wood pile (so the sawmills never starve)
 * but leaves its *output* planks pile buffer-less (drain-me), and both sawmills share
 * one configuration at 55% planks.
 *
 * Projects, dwellings, and shops are **not** pre-placed: the residential and
 * commercial zones start empty so spontaneous construction (housing + shops) can
 * happen. The forest is the only resource area; the zones/gap are concrete and
 * burden-free (no deposits, no loose goods).
 */
export const commons = {
	seed: 549,
	terrains: {
		concrete: [
			// Grove
			[0, -1],
			[1, -1],
			[1, -2],
			[0, -2],
			// Mill
			[4, -1],
			[5, -1],
			[4, -2],
			[5, -2],
			[6, -2],
			// Quarry
			[-4, -1],
			[-5, -1],
			[-4, -2],
			// Depot (west, left of the settlements)
			[-9, -1],
			[-9, -2],
			[-8, -2],
			[-8, -1],
			[-7, -2],
			// Zones + gap: concrete (empty generation) so the residential/commercial
			// zones and the road corridor start burden-free — no berry bushes / loose
			// goods to offload at gamestart. The forest is the only resource area.
			...commonsResidential,
			...commonsCommercial,
			...commonsGap,
		],
		forest: commonsGroveWood,
	},
	hives: [
		{
			name: 'Grove',
			alveoli: [
				{ alveolus: 'freight_bay', coord: [0, -1] },
				{ alveolus: 'tree_chopper', coord: [1, -1] },
				{ alveolus: 'forester', coord: [1, -2], assignedZoneIndices: [2] },
				// Output (drain-me) pile: the chopper sheds its wood here; buffer-less so
				// it always releases its stock to the gather / "Mill wood run" lines.
				{ alveolus: 'pile', coord: [0, -2], variant: 'wood', goods: { wood: 6 } },
			],
		},
		{
			name: 'Mill',
			alveoli: [
				{ alveolus: 'freight_bay', coord: [4, -1] },
				// Both sawmills share one named configuration at 55% planks (product ratio).
				{
					alveolus: 'sawmill',
					coord: [5, -1],
					configuration: { ref: { scope: 'named', name: 'planks-55' } },
				},
				{
					alveolus: 'sawmill',
					coord: [4, -2],
					configuration: { ref: { scope: 'named', name: 'planks-55' } },
				},
				// Input holding pile: buffered wood so the sawmills never starve. The
				// keep-target makes the pile *demand* wood back up to its target, while
				// still releasing to the sawmills' 2-use demand whenever it has stock.
				{
					alveolus: 'pile',
					coord: [5, -2],
					variant: 'wood',
					goods: { wood: 6 },
					configuration: {
						ref: { scope: 'individual' },
						individual: { working: true, buffers: { wood: 12 } },
					},
				},
				// Output-only (drain-me) pile: NOT buffered — planks are meant to leave.
				{ alveolus: 'pile', coord: [6, -2], variant: 'planks', goods: { planks: 3 } },
			],
		},
		{
			name: 'Quarry',
			alveoli: [
				{ alveolus: 'freight_bay', coord: [-4, -1] },
				{ alveolus: 'stonecutter', coord: [-5, -1] },
				// Output (drain-me) pile: the cutter sheds its stone here; buffer-less so
				// it always releases its stock to the gather / transport lines.
				{ alveolus: 'pile', coord: [-4, -2], variant: 'stone', goods: { stone: 4 } },
			],
		},
		{
			name: 'Depot',
			alveoli: [
				{ alveolus: 'freight_bay', coord: [-9, -1] },
				// Construction-materials buffer: keep ~5 units (2 slots × 3 capacity) of
				// wood + planks here, and stone + concrete in the sibling storage.
				{
					alveolus: 'storage',
					coord: [-9, -2],
					goods: { wood: 3, planks: 2 },
					configuration: {
						ref: { scope: 'individual' },
						individual: {
							working: true,
							generalSlots: 2,
							goods: {
								wood: { minSlots: 2, maxSlots: 1 },
								planks: { minSlots: 2, maxSlots: 1 },
							},
						},
					},
				},
				{
					alveolus: 'storage',
					coord: [-8, -2],
					goods: { stone: 3, concrete: 2 },
					configuration: {
						ref: { scope: 'individual' },
						individual: {
							working: true,
							generalSlots: 2,
							goods: {
								stone: { minSlots: 2, maxSlots: 1 },
								concrete: { minSlots: 2, maxSlots: 1 },
							},
						},
					},
				},
				{ alveolus: 'engineer', coord: [-8, -1], variant: 'building' },
				{ alveolus: 'engineer', coord: [-7, -2], variant: 'road' },
			],
		},
	],
	freightLines: [
		{
			name: 'Grove gather',
			cyclic: true,
			stops: [
				{
					loadSelection: constructionGoodsSelection,
					unloadSelection: constructionGoodsSelection,
					anchor: {
						kind: 'alveolus',
						hiveName: 'Grove',
						alveolusType: 'freight_bay',
						coord: [0, -1],
					},
				},
				{
					loadSelection: constructionGoodsSelection,
					unloadSelection: constructionGoodsSelection,
					zone: { kind: 'radius', center: [2, -4], radius: 6 },
				},
			],
		},
		{
			name: 'Mill wood run',
			cyclic: true,
			stops: [
				{
					loadSelection: woodOnlySelection,
					unloadSelection: planksOnlySelection,
					anchor: {
						kind: 'alveolus',
						hiveName: 'Grove',
						alveolusType: 'freight_bay',
						coord: [0, -1],
					},
				},
				{
					loadSelection: planksOnlySelection,
					unloadSelection: woodOnlySelection,
					anchor: {
						kind: 'alveolus',
						hiveName: 'Mill',
						alveolusType: 'freight_bay',
						coord: [4, -1],
					},
				},
			],
		},
		{
			name: 'Commerce loop',
			cyclic: true,
			stops: [
				{
					loadSelection: planksOnlySelection,
					unloadSelection: concreteOnlySelection,
					anchor: {
						kind: 'alveolus',
						hiveName: 'Mill',
						alveolusType: 'freight_bay',
						coord: [4, -1],
					},
				},
				{
					loadSelection: concreteOnlySelection,
					unloadSelection: planksOnlySelection,
					trade: { kind: 'settlement', center: { q: 7, r: 19 }, profile: undefined! },
				},
			],
		},
	],
	zones: [
		{ type: 'residential', coords: commonsResidential },
		{ type: 'commercial', coords: commonsCommercial },
		{
			name: 'Grove Wood',
			color: '#3f9f6b',
			type: 'harvest',
			coords: commonsGroveWood,
		},
	],
	// The separator road between the two zones, running vertically through the gap.
	roads: {
		path: [
			[-1, 2.5],
			[-1, 3.5],
			[-1, 4.5],
			[-1, 5.5],
		],
	},
	dwellings: [],
	shops: [],
	looseGoods: {
		// Only in the forest (never on residential/commercial/hive tiles), so the
		// gather route collects these instead of offloading onto occupied tiles.
		wood: [
			[2, -4],
			[3, -4],
			[4, -4],
		],
		berries: [
			[1, -5],
			[2, -5],
		],
	},
	playerAccount: { balanceVp: 200 },
	vehicles: [
		{
			name: 'commons:wheelbarrow1',
			vehicleType: 'wheelbarrow',
			position: { q: 0, r: -1 },
			servedLineIndices: [0],
		},
		{
			name: 'commons:wheelbarrow2',
			vehicleType: 'wheelbarrow',
			position: { q: 4, r: -1 },
			servedLineIndices: [1],
		},
		{
			name: 'commons:suv',
			vehicleType: 'suv',
			position: { q: 3, r: -1 },
			servedLineIndices: [2],
		},
		// Free vehicles (no served line, no operator) — the pool the one-shot
		// construction-line spawner draws from. Vehicles are never spawned.
		{ name: 'commons:wheelbarrow3', vehicleType: 'wheelbarrow', position: { q: 2, r: -1 } },
		{ name: 'commons:wheelbarrow4', vehicleType: 'wheelbarrow', position: { q: 6, r: 1 } },
		{ name: 'commons:pickup-truck', vehicleType: 'pickup_truck', position: { q: 8, r: 1 } },
	],
	// Global named configurations — reusable across alveoli/hives. The two Mill
	// sawmills both point at `sawmill` → `planks-55`, so editing it updates both.
	namedConfigurations: {
		sawmill: {
			'planks-55': { working: true, productRatio: { maxProductRatio: 0.55 } },
		},
	},
} satisfies GamePatches
