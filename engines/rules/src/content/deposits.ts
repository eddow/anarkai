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
} as const
