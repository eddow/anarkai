export const deposits = {
	berry_bush: {
		maxAmount: 18,
		regenerate: 0.01,
		generation: {
			berries: 0.000214, // Balanced for 1 berry per bush at equilibrium
		},
	},
	rock: {
		maxAmount: 18,
	},
	tree: {
		maxAmount: 12,
		regenerate: 0.01,
		generation: {
			mushrooms: 0.000097, // Balanced for 1 mushroom per 2 trees at equilibrium
		},
	},
	wheat_crop: {
		maxAmount: 18,
	},
	ore_seam: {
		maxAmount: 24,
	},
	coal_seam: {
		maxAmount: 24,
	},
	tar_pit: {
		maxAmount: 12,
		regenerate: 0.005,
	},
	clay_bed: {
		maxAmount: 18,
	},
	sand_deposit: {
		maxAmount: 18,
	},
	scrapyard: {
		maxAmount: 20,
	},
	aquifer: {
		maxAmount: 24,
		regenerate: 0.02,
	},
} as const
