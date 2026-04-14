export const terrain = {
	water: {},
	forest: {
		generation: {
			deposits: { tree: 0.7 },
			goods: { mushrooms: 0.3 },
		},
	},
	rocky: {
		generation: {
			deposits: { rock: 0.6 },
		},
	},
	grass: {
		generation: {
			deposits: { berry_bush: 0.1 },
		},
	},
	concrete: {},
	sand: {
		generation: {
			deposits: { rock: 0.3 },
			goods: { berries: 0.05 },
		},
	},
	snow: {},
} as const
