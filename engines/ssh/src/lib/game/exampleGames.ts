import type { GamePatches } from './game'
// TODO: check how goods are rendered. Hint: on tick, some are created, some are removed (especially with a wide view) => if we have to re-generate a whole sector's good on each change, it's on each tick, which is a perf nightmare. Instead, we should be able to just add/remove the delta of goods on each tick, which is much more efficient. This is a good example of a place where we should be using patches instead of re-generating the whole world on each tick.
export const chopSaw = {
	// TODO: terrain-types should be made another way {type: axial[]}, we'll add next patches in tiles, even though even these ones will be optimized
	tiles: [
		{ coord: [10, -8], terrain: 'concrete' },
		{ coord: [13, -7], terrain: 'concrete' },
		{ coord: [11, -8], terrain: 'concrete' },
		{ coord: [11, -7], terrain: 'concrete' },
		{ coord: [12, -8], terrain: 'concrete' },
		{ coord: [12, -7], terrain: 'concrete' },
	],
	hives: [
		{
			name: 'ChopSaw',
			alveoli: [
				{ alveolus: 'tree_chopper', coord: [10, -8] },
				{ alveolus: 'stonecutter', coord: [13, -7] },
				{ alveolus: 'storage', coord: [11, -8] },
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
			mode: 'gather',
			stops: [{ hiveName: 'ChopSaw', alveolusType: 'freight_bay', coord: [11, -7] }],
			radius: 9,
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
} satisfies GamePatches
