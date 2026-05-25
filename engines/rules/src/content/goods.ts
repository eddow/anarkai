export const goods = {
	berries: {
		satiationStrength: 0.3567, // felt ~0.3 hunger relief at equilibrium
		halfLife: 1200,
		massKg: 1,
		baseValueVp: 2,
		tags: ['food'],
	},
	concrete: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 12,
		baseValueVp: 10,
		tags: ['bulk', 'construction/concrete', 'basic-materials'],
	},
	mushrooms: {
		satiationStrength: Math.LN2, // felt ~0.5 hunger relief at equilibrium
		halfLife: 600,
		massKg: 1,
		baseValueVp: 3,
		tags: ['food'],
	},
	sandwich: {
		satiationStrength: 1.05,
		halfLife: 900,
		massKg: 1,
		baseValueVp: 8,
		tags: ['food', 'prepared-food', 'commercial/restaurant'],
	},
	clothes: {
		halfLife: 2400,
		massKg: 2,
		baseValueVp: 12,
		tags: ['piece', 'personal-goods', 'commercial/clothes'],
	},
	sunglasses: {
		halfLife: 3600,
		massKg: 1,
		baseValueVp: 10,
		tags: ['piece', 'personal-goods', 'commercial/clothes'],
	},
	wheat: {
		halfLife: 1800,
		massKg: 3,
		baseValueVp: 3,
		tags: ['food', 'grain'],
	},
	flour: {
		halfLife: 1600,
		massKg: 2,
		baseValueVp: 5,
		tags: ['food', 'grain', 'prepared-food'],
	},
	bread: {
		satiationStrength: 0.82,
		halfLife: 900,
		massKg: 1,
		baseValueVp: 7,
		tags: ['food', 'prepared-food', 'commercial/restaurant'],
	},
	planks: {
		halfLife: 1200,
		massKg: 4,
		baseValueVp: 8,
		tags: ['piece', 'construction/lumber', 'basic-materials'],
	},
	stone: {
		halfLife: Number.POSITIVE_INFINITY, // infinite half-life
		massKg: 20,
		baseValueVp: 4,
		tags: ['bulk', 'construction/stone', 'basic-materials'],
	},
	wood: {
		halfLife: 900,
		massKg: 8,
		baseValueVp: 5,
		tags: ['bulk', 'construction/lumber', 'basic-materials'],
	},
} as const
