import type { GamePatches } from './game'

export const chopSaw = {
	hives: [
		{
			name: 'ChopSaw',
			alveoli: [
				{ alveolus: 'tree_chopper', coord: [0, 0] },
				{ alveolus: 'stonecutter', coord: [0, -1] },
				{ alveolus: 'gather', coord: [1, 0] },
				{ alveolus: 'sawmill', coord: [1, 1] },
				{ alveolus: 'engineer', coord: [2, 0] },
				{ alveolus: 'storage', coord: [0, 1] },
			],
		},
	],
	zones: {
		harvest: [
			[-1, 2],
			[-2, 2],
			[-2, 3],
			[-3, 3],
		],
	},
	projects: {
		'build:storage': [
			[-1, 1],
			[0, 2],
		],
	},
} satisfies GamePatches
