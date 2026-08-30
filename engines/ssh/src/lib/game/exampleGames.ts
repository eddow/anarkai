import type { HivePlan, HivePlanEntry } from 'ssh/hive-plan'
import { hivePlanFingerprint, hivePlanValidationRequirements } from 'ssh/hive-plan'
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

const stoneOnlySelection = {
	goodRules: [{ goodType: 'stone', effect: 'allow' }],
	tagRules: [],
	defaultEffect: 'deny',
} as const

const woodAndPlanksSelection = {
	goodRules: [
		{ goodType: 'wood', effect: 'allow' },
		{ goodType: 'planks', effect: 'allow' },
	],
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

// Two 3×3 settlement zones nudged toward the hives — residential (east) beside
// commercial (west). NOT foundationed: no concrete patch, so seed terrain (and any
// deposits / loose goods it generates) is left untouched. The only terrain edits are
// the resource areas (forest); the hives get their concrete footing from the
// hive patch itself, not from `terrains`.
const sovietResidential = axialRect(-9, -7, 1, 3)
const sovietCommercial = axialRect(-12, -10, 1, 3)
const sovietWoodland = axialRect(-11, -8, -6, -4)

/**
 * A registered hive plan in `working` stage: the canonical design for a hive, with
 * entries expressed **relative** to the freight bay at [0,0] so the same design can
 * be re-placed anywhere. Validation progress is marked complete.
 */
function registeredWorkingPlan(name: string, entries: readonly HivePlanEntry[]): HivePlan {
	const copied = entries.map((entry) => ({ ...entry }))
	const requirements = hivePlanValidationRequirements(copied, [])
	return {
		name,
		stage: 'working',
		entries: copied,
		validationProgress: {
			...requirements,
			workSecondsApplied: requirements.workSecondsRequired,
		},
		knownnessFingerprint: hivePlanFingerprint(copied),
	}
}

/**
 * Wood design (relative to the bay at [0,0]): forester + chopper + sawmill +
 * wood-pile (buffered to 100%) + plank-pile (drain-me) + general storage + build
 * engineer + freight bay. The sawmill shares the named `planks-55` configuration.
 * Laid out on **two rows** so no alveolus is fully boxed in by its neighbours (every
 * building keeps at least one open tile for vehicle/pedestrian pathing).
 */
const woodPlanEntries: readonly HivePlanEntry[] = [
	// Row 0 (r = 0): the production line.
	{ alveolusType: 'freight_bay', coord: [0, 0] },
	{ alveolusType: 'tree_chopper', coord: [1, 0] },
	{ alveolusType: 'forester', coord: [2, 0] },
	{
		alveolusType: 'sawmill',
		coord: [3, 0],
		configuration: { ref: { scope: 'named', name: 'planks-55' } },
	},
	// Row 1 (r = 1): buffers + engineer.
	{
		alveolusType: 'storage',
		coord: [0, 1],
		configuration: {
			ref: { scope: 'individual' },
			individual: {
				working: true,
				generalSlots: 2,
				goods: {
					wood: { minSlots: 1, maxSlots: 1 },
					planks: { minSlots: 1, maxSlots: 1 },
					stone: { minSlots: 1, maxSlots: 1 },
					concrete: { minSlots: 1, maxSlots: 1 },
				},
			},
		},
	},
	{ alveolusType: 'engineer', coord: [1, 1], variant: 'building' },
	{
		alveolusType: 'pile',
		coord: [2, 1],
		variant: 'wood',
		configuration: {
			ref: { scope: 'individual' },
			individual: { working: true, buffers: { wood: 24 } },
		},
	},
	{ alveolusType: 'pile', coord: [3, 1], variant: 'planks' },
]

/**
 * Stone design (relative to the bay at [0,0]): stonecutter + stone pile + general
 * storage + road engineer + freight bay. Two rows, same open-perimeter rule as Wood.
 */
const stonePlanEntries: readonly HivePlanEntry[] = [
	// Row 0 (r = 0): the quarrying line.
	{ alveolusType: 'freight_bay', coord: [0, 0] },
	{ alveolusType: 'stonecutter', coord: [1, 0] },
	{ alveolusType: 'pile', coord: [2, 0], variant: 'stone' },
	// Row 1 (r = 1): buffer + engineer.
	{
		alveolusType: 'storage',
		coord: [0, 1],
		configuration: {
			ref: { scope: 'individual' },
			individual: {
				working: true,
				generalSlots: 2,
				goods: {
					stone: { minSlots: 2, maxSlots: 1 },
					wood: { minSlots: 2, maxSlots: 1 },
				},
			},
		},
	},
	{ alveolusType: 'engineer', coord: [1, 1], variant: 'road' },
]

/**
 * `soviet` — two self-contained production hive **designs**, each registered as a
 * working hive plan, instantiated as two W+S pairs on the board.
 *
 *   - **Wood**  (forestry → planks): forester + chopper + sawmill + wood-pile
 *     (buffered to 100%) + plank-pile (drain-me) + general storage + build engineer
 *     + freight bay. The sawmill shares the named `planks-55` config (55% planks vs
 *     wood).
 *   - **Stone** (quarrying): stonecutter + stone pile + general storage + road
 *     engineer + freight bay.
 *
 * Two pairs are placed, each `hivePlanIndex`-linked to its design (Wood→0, Stone→1):
 *   - Pair 1: **Wood** at -9,-2, **Stone** at -18,6.
 *   - Pair 2 (around -30,-2, wood upward / stone downward): **Wood II** at -30,-2,
 *     **Stone II** at -30,+2.
 *
 * Unlike the old `commons`, the chopper and sawmill live in the **same** hive, so
 * wood → planks flows by intra-hive convey (no inter-hive wood shuttle). The pair-1
 * hives trade the one thing the other lacks: stone ships west-to-wood, wood/planks
 * ship east-to-stone. Planks export for concrete (the build engineer's foundation
 * good). Each pair has its own gather / exchange / commerce freight lines and vehicles;
 * the duplicated pair is staffed with explicit `characters` (chopper / forester /
 * sawyer / builder for Wood II, cutter / roadworker for Stone II), with vehicle
 * operators picked up dynamically by the planner.
 *
 * The residential and commercial zones are 3×3, empty (spontaneous construction only),
 * and **not** foundationed — the only terrain modification sits under the built hives
 * (the hive patch lays their concrete footing). The harvest zone (Woodland) is a
 * position-only marker for now: its seed terrain stays untouched. Zone re-assignment
 * comes later.
 */
export const soviet = {
	seed: 549,
	hives: [
		{
			name: 'Wood',
			alveoli: [
				// Row 0 (r = -2): the production line.
				{ alveolus: 'freight_bay', coord: [-9, -2], hivePlanIndex: 0 },
				{ alveolus: 'tree_chopper', coord: [-8, -2], hivePlanIndex: 0 },
				{ alveolus: 'forester', coord: [-7, -2], assignedZoneIndices: [2], hivePlanIndex: 0 },
				// Sawmill shares the named `planks-55` configuration (55% planks vs wood).
				{
					alveolus: 'sawmill',
					coord: [-6, -2],
					hivePlanIndex: 0,
					configuration: { ref: { scope: 'named', name: 'planks-55' } },
				},
				// Row 1 (r = -1): buffers + engineer.
				// Construction-materials buffer for the build engineer.
				{
					alveolus: 'storage',
					coord: [-9, -1],
					goods: { wood: 3, planks: 2, stone: 2, concrete: 2 },
					hivePlanIndex: 0,
					configuration: {
						ref: { scope: 'individual' },
						individual: {
							working: true,
							generalSlots: 2,
							goods: {
								wood: { minSlots: 1, maxSlots: 1 },
								planks: { minSlots: 1, maxSlots: 1 },
								stone: { minSlots: 1, maxSlots: 1 },
								concrete: { minSlots: 1, maxSlots: 1 },
							},
						},
					},
				},
				{ alveolus: 'engineer', coord: [-8, -1], variant: 'building', hivePlanIndex: 0 },
				// Input holding pile: buffered to 100% (24/24) so the sawmill never
				// starves, while still releasing wood on demand.
				{
					alveolus: 'pile',
					coord: [-7, -1],
					variant: 'wood',
					goods: { wood: 6 },
					hivePlanIndex: 0,
					configuration: {
						ref: { scope: 'individual' },
						individual: { working: true, buffers: { wood: 24 } },
					},
				},
				// Output-only (drain-me) pile: planks are meant to leave.
				{
					alveolus: 'pile',
					coord: [-6, -1],
					variant: 'planks',
					goods: { planks: 3 },
					hivePlanIndex: 0,
				},
			],
		},
		{
			name: 'Stone',
			alveoli: [
				// Row 0 (r = 6): the quarrying line.
				{ alveolus: 'freight_bay', coord: [-18, 6], hivePlanIndex: 1 },
				{ alveolus: 'stonecutter', coord: [-17, 6], hivePlanIndex: 1 },
				{
					alveolus: 'pile',
					coord: [-16, 6],
					variant: 'stone',
					goods: { stone: 3 },
					hivePlanIndex: 1,
				},
				// Row 1 (r = 7): buffer + engineer.
				// Construction-materials buffer for the road engineer.
				{
					alveolus: 'storage',
					coord: [-18, 7],
					goods: { stone: 3, wood: 2 },
					hivePlanIndex: 1,
					configuration: {
						ref: { scope: 'individual' },
						individual: {
							working: true,
							generalSlots: 2,
							goods: {
								stone: { minSlots: 2, maxSlots: 1 },
								wood: { minSlots: 2, maxSlots: 1 },
							},
						},
					},
				},
				{ alveolus: 'engineer', coord: [-17, 7], variant: 'road', hivePlanIndex: 1 },
			],
		},
		{
			name: 'Wood II',
			alveoli: [
				// Row 0 (r = -2): the production line.
				{ alveolus: 'freight_bay', coord: [-30, -2], hivePlanIndex: 0 },
				{ alveolus: 'tree_chopper', coord: [-29, -2], hivePlanIndex: 0 },
				// No assigned zone yet — zone re-affect happens later.
				{ alveolus: 'forester', coord: [-28, -2], hivePlanIndex: 0 },
				{
					alveolus: 'sawmill',
					coord: [-27, -2],
					hivePlanIndex: 0,
					configuration: { ref: { scope: 'named', name: 'planks-55' } },
				},
				// Row 1 (r = -1): buffers + engineer.
				{
					alveolus: 'storage',
					coord: [-30, -1],
					goods: { wood: 3, planks: 2, stone: 2, concrete: 2 },
					hivePlanIndex: 0,
					configuration: {
						ref: { scope: 'individual' },
						individual: {
							working: true,
							generalSlots: 2,
							goods: {
								wood: { minSlots: 1, maxSlots: 1 },
								planks: { minSlots: 1, maxSlots: 1 },
								stone: { minSlots: 1, maxSlots: 1 },
								concrete: { minSlots: 1, maxSlots: 1 },
							},
						},
					},
				},
				{ alveolus: 'engineer', coord: [-29, -1], variant: 'building', hivePlanIndex: 0 },
				{
					alveolus: 'pile',
					coord: [-28, -1],
					variant: 'wood',
					goods: { wood: 6 },
					hivePlanIndex: 0,
					configuration: {
						ref: { scope: 'individual' },
						individual: { working: true, buffers: { wood: 24 } },
					},
				},
				{
					alveolus: 'pile',
					coord: [-27, -1],
					variant: 'planks',
					goods: { planks: 3 },
					hivePlanIndex: 0,
				},
			],
		},
		{
			name: 'Stone II',
			alveoli: [
				// Row 0 (r = 2): the quarrying line.
				{ alveolus: 'freight_bay', coord: [-30, 2], hivePlanIndex: 1 },
				{ alveolus: 'stonecutter', coord: [-29, 2], hivePlanIndex: 1 },
				{
					alveolus: 'pile',
					coord: [-28, 2],
					variant: 'stone',
					goods: { stone: 3 },
					hivePlanIndex: 1,
				},
				// Row 1 (r = 3): buffer + engineer.
				{
					alveolus: 'storage',
					coord: [-30, 3],
					goods: { stone: 3, wood: 2 },
					hivePlanIndex: 1,
					configuration: {
						ref: { scope: 'individual' },
						individual: {
							working: true,
							generalSlots: 2,
							goods: {
								stone: { minSlots: 2, maxSlots: 1 },
								wood: { minSlots: 2, maxSlots: 1 },
							},
						},
					},
				},
				{ alveolus: 'engineer', coord: [-29, 3], variant: 'road', hivePlanIndex: 1 },
			],
		},
	],
	freightLines: [
		{
			name: 'Wood gather',
			cyclic: true,
			stops: [
				{
					loadSelection: constructionGoodsSelection,
					unloadSelection: constructionGoodsSelection,
					anchor: {
						kind: 'alveolus',
						hiveName: 'Wood',
						alveolusType: 'freight_bay',
						coord: [-9, -2],
					},
				},
				{
					loadSelection: constructionGoodsSelection,
					unloadSelection: constructionGoodsSelection,
					// Radius zone centred on the bay anchor (gather route); radius 6
					// reaches the Woodland forest.
					zone: { kind: 'radius', center: [-9, -2], radius: 6 },
				},
			],
		},
		{
			name: 'Stone deliver',
			cyclic: true,
			stops: [
				{
					loadSelection: stoneOnlySelection,
					unloadSelection: woodAndPlanksSelection,
					anchor: {
						kind: 'alveolus',
						hiveName: 'Stone',
						alveolusType: 'freight_bay',
						coord: [-18, 6],
					},
				},
				{
					loadSelection: woodAndPlanksSelection,
					unloadSelection: stoneOnlySelection,
					anchor: {
						kind: 'alveolus',
						hiveName: 'Wood',
						alveolusType: 'freight_bay',
						coord: [-9, -2],
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
						hiveName: 'Wood',
						alveolusType: 'freight_bay',
						coord: [-9, -2],
					},
				},
				{
					loadSelection: concreteOnlySelection,
					unloadSelection: planksOnlySelection,
					trade: { kind: 'settlement', center: { q: -4, r: -17 }, profile: undefined! },
				},
			],
		},
		{
			name: 'Wood II gather',
			cyclic: true,
			stops: [
				{
					loadSelection: constructionGoodsSelection,
					unloadSelection: constructionGoodsSelection,
					anchor: {
						kind: 'alveolus',
						hiveName: 'Wood II',
						alveolusType: 'freight_bay',
						coord: [-30, -2],
					},
				},
				{
					loadSelection: constructionGoodsSelection,
					unloadSelection: constructionGoodsSelection,
					// Radius zone centred on the bay anchor (gather route).
					zone: { kind: 'radius', center: [-30, -2], radius: 6 },
				},
			],
		},
		{
			name: 'Stone II deliver',
			cyclic: true,
			stops: [
				{
					loadSelection: stoneOnlySelection,
					unloadSelection: woodAndPlanksSelection,
					anchor: {
						kind: 'alveolus',
						hiveName: 'Stone II',
						alveolusType: 'freight_bay',
						coord: [-30, 2],
					},
				},
				{
					loadSelection: woodAndPlanksSelection,
					unloadSelection: stoneOnlySelection,
					anchor: {
						kind: 'alveolus',
						hiveName: 'Wood II',
						alveolusType: 'freight_bay',
						coord: [-30, -2],
					},
				},
			],
		},
		{
			name: 'Commerce loop II',
			cyclic: true,
			stops: [
				{
					loadSelection: planksOnlySelection,
					unloadSelection: concreteOnlySelection,
					anchor: {
						kind: 'alveolus',
						hiveName: 'Wood II',
						alveolusType: 'freight_bay',
						coord: [-30, -2],
					},
				},
				{
					loadSelection: concreteOnlySelection,
					unloadSelection: planksOnlySelection,
					trade: { kind: 'settlement', center: { q: -4, r: -17 }, profile: undefined! },
				},
			],
		},
	],
	zones: [
		{ type: 'residential', coords: sovietResidential },
		{ type: 'commercial', coords: sovietCommercial },
		// Position-only harvest marker: terrain/content is left to the seed until
		// the zone is re-affect later.
		{ name: 'Woodland', color: '#3f9f6b', type: 'harvest', coords: sovietWoodland },
	],
	dwellings: [],
	shops: [],
	playerAccount: { balanceVp: 200 },
	vehicles: [
		{
			name: 'soviet:wheelbarrow1',
			vehicleType: 'wheelbarrow',
			position: { q: -9, r: -2 },
			servedLineIndices: [0],
		},
		{
			name: 'soviet:wheelbarrow2',
			vehicleType: 'wheelbarrow',
			position: { q: -18, r: 6 },
			servedLineIndices: [1],
		},
		{
			name: 'soviet:suv',
			vehicleType: 'suv',
			position: { q: -10, r: -2 },
			servedLineIndices: [2],
		},
		// Free vehicles (no served line, no operator) — the pool the one-shot
		// construction-line spawner draws from. Vehicles are never spawned.
		{ name: 'soviet:wheelbarrow3', vehicleType: 'wheelbarrow', position: { q: -8, r: 0 } },
		{ name: 'soviet:wheelbarrow4', vehicleType: 'wheelbarrow', position: { q: -16, r: 6 } },
		{ name: 'soviet:pickup-truck', vehicleType: 'pickup_truck', position: { q: -17, r: 5 } },
		// ── Pair 2 (Wood II / Stone II) ────────────────────────────────────
		{
			name: 'soviet:wheelbarrow5',
			vehicleType: 'wheelbarrow',
			position: { q: -30, r: -2 },
			servedLineIndices: [3],
		},
		{
			name: 'soviet:wheelbarrow6',
			vehicleType: 'wheelbarrow',
			position: { q: -30, r: 2 },
			servedLineIndices: [4],
		},
		{
			name: 'soviet:suv2',
			vehicleType: 'suv',
			position: { q: -29, r: -2 },
			servedLineIndices: [5],
		},
	],
	// Workers staffing the duplicated pair (Wood II / Stone II). Vehicle operators
	// are picked up dynamically by the planner from the free workers / generated population.
	characters: [
		// Wood II — chopper + forester + sawmill + build engineer.
		{ name: 'Wood II chopper', position: { q: -29, r: -2 }, assignedAlveolus: [-29, -2] },
		{ name: 'Wood II forester', position: { q: -28, r: -2 }, assignedAlveolus: [-28, -2] },
		{ name: 'Wood II sawyer', position: { q: -27, r: -2 }, assignedAlveolus: [-27, -2] },
		{ name: 'Wood II builder', position: { q: -29, r: -1 }, assignedAlveolus: [-29, -1] },
		// Stone II — stonecutter + road engineer.
		{ name: 'Stone II cutter', position: { q: -29, r: 2 }, assignedAlveolus: [-29, 2] },
		{ name: 'Stone II roadworker', position: { q: -29, r: 3 }, assignedAlveolus: [-29, 3] },
	],
	// The two hive designs, registered as working plans. Every hive above links to
	// one of these via `hivePlanIndex`: Wood/Wood II → 0, Stone/Stone II → 1.
	hivePlans: [
		registeredWorkingPlan('Wood', woodPlanEntries),
		registeredWorkingPlan('Stone', stonePlanEntries),
	],
	// Global named configurations — reusable across alveoli/hives. The wood sawmill
	// points at `sawmill` → `planks-55`.
	namedConfigurations: {
		sawmill: {
			'planks-55': { working: true, productRatio: { maxProductRatio: 0.55 } },
		},
	},
} satisfies GamePatches
