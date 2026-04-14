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
		action: { type: 'storage', kind: 'slotted', capacity: 3, slots: 6 },
		workTime: 0,
		construction: {
			goods: { wood: 2, planks: 2, stone: 1 },
			time: 6,
		},
	},
	woodpile: {
		preparationTime: 1,
		action: { type: 'storage', kind: 'specific', goods: { wood: 24 } },
		workTime: 0,
		construction: {
			goods: { wood: 10 },
			time: 4,
		},
	},
	freight_bay: {
		preparationTime: 1,
		action: { type: 'road-fret', kind: 'slotted', capacity: 2, slots: 4 },
		workTime: 0,
		construction: {
			goods: { wood: 2, planks: 1 },
			time: 4,
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
} as const
