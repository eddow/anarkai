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
} as const satisfies Record<string, Ssh.TerrainDefinition>

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
} as const satisfies Record<string, Ssh.DepositDefinition>

export const alveoli = {
	tree_chopper: {
		preparationTime: 2,
		action: { type: 'harvest', deposit: 'tree', output: { wood: 1 } },
		workTime: 3,
		construction: {
			goods: { stone: 2 }, // No wood/plank cost for the wood-chopper itself
			time: 4,
		},
	},
	stonecutter: {
		preparationTime: 3,
		action: { type: 'harvest', deposit: 'rock', output: { stone: 1 } },
		workTime: 4,
		construction: {
			goods: { wood: 2, planks: 1 }, // No stone cost for the stone cutter
			time: 5,
		},
	},
	sawmill: {
		preparationTime: 1,
		action: { type: 'transform', inputs: { wood: 1 }, output: { planks: 1 } },
		workTime: 2,
		construction: {
			goods: { wood: 3, stone: 2 }, // No planks cost for the sawmill
			time: 6,
		},
	},
	storage: {
		preparationTime: 1,
		action: { type: 'storage', capacity: 3, slots: 6 },
		workTime: 0,
		construction: {
			goods: { wood: 2, planks: 2, stone: 1 },
			time: 6,
		},
	},
	gather: {
		preparationTime: 1,
		action: { type: 'gather', radius: 9 },
		workTime: 2,
		construction: {
			goods: { wood: 1, planks: 1, stone: 1 },
			time: 5,
		},
	},
	engineer: {
		preparationTime: 1,
		action: { type: 'engineer', radius: 6 },
		workTime: 2,
		construction: {
			goods: { wood: 1, stone: 1 },
			time: 4,
		},
	},
} as const satisfies Record<string, Ssh.AlveolusDefinition>

export const goods = {
	berries: {
		feedingValue: 72,
		halfLife: 300,
	},
	mushrooms: {
		feedingValue: 160,
		halfLife: 600,
	},
	planks: {
		halfLife: 1200,
	},
	stone: {
		halfLife: Infinity, // infinite half-life
	},
	wood: {
		halfLife: 900,
	},
} as const satisfies Record<string, Ssh.GoodsDefinition>

export const vehicles = {
	'by-hands': {
		storage: { capacity: 1, slots: 2 },
		walkTime: 1, // Time to walk by foot
		transferTime: 1, // Time to grab/drop items by hand
	},
} as const satisfies Record<string, Ssh.VehicleDefinition>

