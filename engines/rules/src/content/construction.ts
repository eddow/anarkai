export const construction = {
	foundation: {
		goods: { concrete: 1 },
		time: 3,
	},
	dwellings: {
		basic_dwelling: {
			goods: { wood: 2, planks: 1 },
			time: 5,
		},
	},
	/** Per-segment road construction (built one border at a time by road engineers). */
	road: {
		path: { goods: { stone: 1 }, time: 2 },
		asphalt: { goods: { stone: 2, planks: 1 }, time: 3 },
	},
	demolition: {
		/** Seconds of construction-engineer work to demolish a structure tile. */
		structureTime: 4,
		/** Seconds of road-engineer work to demolish one road segment. */
		roadTime: 2,
		/** Fraction of construction materials refunded as loose goods on demolition. */
		refundFraction: 0.5,
	},
} as const
