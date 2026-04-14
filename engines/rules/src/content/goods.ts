export const goods = {
	berries: {
		satiationStrength: 0.3567, // felt ~0.3 hunger relief at equilibrium
		halfLife: 1200,
		massKg: 1,
		baseValueVp: 2,
		tags: ['food'],
	},
	mushrooms: {
		satiationStrength: Math.LN2, // felt ~0.5 hunger relief at equilibrium
		halfLife: 600,
		massKg: 1,
		baseValueVp: 3,
		tags: ['food'],
	},
	planks: {
		halfLife: 1200,
		massKg: 4,
		baseValueVp: 8,
		tags: ['piece', 'construction/lumber'],
	},
	stone: {
		halfLife: Number.POSITIVE_INFINITY, // infinite half-life
		massKg: 20,
		baseValueVp: 4,
		tags: ['bulk', 'construction/stone'],
	},
	wood: {
		halfLife: 900,
		massKg: 8,
		baseValueVp: 5,
		tags: ['bulk', 'construction/lumber'],
	},
} as const
