export const goods = {
	// --- Food (final) -----------------------------------------------------
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
	sandwich: {
		satiationStrength: 1.05,
		halfLife: 900,
		massKg: 1,
		baseValueVp: 8,
		tags: ['food', 'prepared-food', 'commercial/restaurant'],
	},
	bread: {
		satiationStrength: 0.82,
		halfLife: 900,
		massKg: 1,
		baseValueVp: 7,
		tags: ['food', 'prepared-food', 'commercial/restaurant'],
	},

	// --- Ingredient (food chain) ------------------------------------------
	wheat: {
		halfLife: 1800,
		massKg: 3,
		baseValueVp: 3,
		tags: ['ingredient', 'grain'],
	},
	flour: {
		halfLife: 1600,
		massKg: 2,
		baseValueVp: 5,
		tags: ['ingredient', 'grain', 'prepared-food'],
	},
	cooking_oil: {
		halfLife: 1800,
		massKg: 2,
		baseValueVp: 6,
		tags: ['ingredient', 'grain'],
	},

	// --- Raw (mineral/timber extraction) -----------------------------------
	wood: {
		halfLife: 900,
		massKg: 8,
		baseValueVp: 5,
		tags: ['bulk', 'construction/lumber', 'raw'],
	},
	stone: {
		halfLife: Number.POSITIVE_INFINITY, // infinite half-life
		massKg: 20,
		baseValueVp: 4,
		tags: ['bulk', 'construction/stone', 'raw'],
	},
	silica_sand: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 10,
		baseValueVp: 2,
		tags: ['bulk', 'construction/sand', 'raw'],
	},
	clay: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 10,
		baseValueVp: 2,
		tags: ['bulk', 'raw'],
	},
	iron_ore: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 15,
		baseValueVp: 4,
		tags: ['bulk', 'raw'],
	},
	copper_ore: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 15,
		baseValueVp: 5,
		tags: ['bulk', 'raw'],
	},
	coal: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 1,
		baseValueVp: 4,
		tags: ['piece', 'research'],
	},
	crude_tar: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 8,
		baseValueVp: 3,
		tags: ['bulk', 'raw'],
	},
	scrap_metal: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 6,
		baseValueVp: 2,
		tags: ['bulk', 'raw'],
	},
	e_waste: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 2,
		baseValueVp: 6,
		tags: ['piece', 'raw'],
	},
	fresh_water: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 1,
		baseValueVp: 1,
		tags: ['bulk', 'raw'],
	},

	// --- Refined (industrial intermediate) ---------------------------------
	glass: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 3,
		baseValueVp: 6,
		tags: ['piece', 'refined'],
	},
	iron_ingot: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 12,
		baseValueVp: 8,
		tags: ['bulk', 'refined'],
	},
	copper_ingot: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 12,
		baseValueVp: 10,
		tags: ['bulk', 'refined'],
	},
	steel: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 12,
		baseValueVp: 14,
		tags: ['bulk', 'refined'],
	},
	refined_fuel: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 5,
		baseValueVp: 9,
		tags: ['piece', 'refined'],
	},
	lye: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 2,
		baseValueVp: 5,
		tags: ['piece', 'refined'],
	},

	// --- Material (finished construction) ----------------------------------
	concrete: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 12,
		baseValueVp: 10,
		tags: ['bulk', 'construction/concrete', 'material'],
	},
	planks: {
		halfLife: 1200,
		massKg: 4,
		baseValueVp: 8,
		tags: ['piece', 'construction/lumber', 'material'],
	},
	bricks: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 15,
		baseValueVp: 5,
		tags: ['bulk', 'construction/brick', 'material'],
	},

	// --- Component (assembled sub-part) ------------------------------------
	mechanical_parts: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 2,
		baseValueVp: 12,
		tags: ['piece', 'component'],
	},
	shafts: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 4,
		baseValueVp: 14,
		tags: ['piece', 'component'],
	},
	circuits: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 1,
		baseValueVp: 16,
		tags: ['piece', 'component'],
	},
	lenses: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 1,
		baseValueVp: 18,
		tags: ['piece', 'component'],
	},
	conveyors: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 10,
		baseValueVp: 20,
		tags: ['bulk', 'component'],
	},
	salvaged_parts: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 2,
		baseValueVp: 8,
		tags: ['piece', 'component'],
	},
	hand_tools: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 3,
		baseValueVp: 6,
		tags: ['piece', 'component'],
	},
	powered_tools: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 5,
		baseValueVp: 20,
		tags: ['piece', 'component'],
	},
	precision_tools: {
		halfLife: Number.POSITIVE_INFINITY,
		massKg: 2,
		baseValueVp: 30,
		tags: ['piece', 'component'],
	},

	// --- Household (generic household goods/machinery) ----------------------
	soap: {
		halfLife: 1200,
		massKg: 1,
		baseValueVp: 8,
		tags: ['piece', 'household'],
	},
	lighting: {
		halfLife: 3600,
		massKg: 2,
		baseValueVp: 15,
		tags: ['piece', 'household'],
	},

	// --- Wearable (carried personal good) ----------------------------------
	clothes: {
		halfLife: 2400,
		massKg: 2,
		baseValueVp: 12,
		tags: ['piece', 'wearable', 'personal-goods', 'commercial/clothes'],
	},
	sunglasses: {
		halfLife: 3600,
		massKg: 1,
		baseValueVp: 10,
		tags: ['piece', 'wearable', 'personal-goods', 'commercial/clothes'],
	},
} as const
