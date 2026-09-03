export const alveoli = {
	forester: {
		preparationTime: 1,
		action: { type: 'plant', deposit: 'tree' },
		workTime: 2,
		construction: {
			goods: { wood: 1, stone: 1 },
			time: 4,
		},
	},
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
		action: {
			type: 'transform',
			rates: { wood: -0.2, planks: 0.2 },
		},
		workTime: 2,
		construction: {
			goods: { wood: 3, stone: 2 }, // No planks cost for the sawmill
			time: 6,
		},
	},
	wheat_planter: {
		preparationTime: 1,
		action: { type: 'plant', deposit: 'wheat_crop' },
		workTime: 2,
		construction: {
			goods: { wood: 1, planks: 1 },
			time: 4,
		},
	},
	wheat_harvester: {
		preparationTime: 1,
		action: { type: 'harvest', deposit: 'wheat_crop', output: { wheat: 1 } },
		workTime: 2,
		construction: {
			goods: { wood: 2, planks: 1 },
			time: 4,
		},
	},
	flour_mill: {
		preparationTime: 1,
		action: {
			type: 'transform',
			rates: { wheat: -0.2, flour: 0.2 },
		},
		workTime: 2,
		construction: {
			goods: { wood: 3, planks: 2, stone: 1 },
			time: 6,
		},
	},
	bakery: {
		preparationTime: 1,
		action: {
			type: 'transform',
			rates: { flour: -0.15, bread: 0.15 },
		},
		workTime: 2,
		construction: {
			goods: { wood: 2, planks: 2, stone: 1 },
			time: 5,
		},
	},
	restaurant: {
		preparationTime: 1,
		action: {
			type: 'transform',
			rates: { berries: -0.1, mushrooms: -0.1, sandwich: 0.1 },
		},
		workTime: 2,
		construction: {
			goods: { wood: 3, planks: 2, stone: 1 },
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
	// Legacy woodpile removed in favor of variant-capable pile
	pile: {
		preparationTime: 0,
		action: { type: 'storage', kind: 'specific', goods: {} }, // minimal root (incomplete)
		workTime: 0,
		construction: {
			goods: { wood: 4 },
			time: 2,
		},
		variants: {
			wood: {
				construction: {
					goods: { wood: 8 },
					time: 4,
				},
				action: { type: 'storage', kind: 'specific', goods: { wood: 24 } },
				variants: {
					extra: {
						construction: {
							goods: { steel: 3, wood: 5 },
							time: 6,
						},
						action: { type: 'storage', kind: 'specific', goods: { wood: 48 } },
					},
				},
			},
			planks: {
				construction: {
					goods: { wood: 3, planks: 5 },
					time: 4,
				},
				action: { type: 'storage', kind: 'specific', goods: { planks: 24 } },
				variants: {
					extra: {
						construction: {
							goods: { steel: 3, planks: 5 },
							time: 6,
						},
						action: { type: 'storage', kind: 'specific', goods: { planks: 48 } },
					},
				},
			},
			stone: {
				construction: {
					goods: { wood: 3, stone: 5 },
					time: 4,
				},
				action: { type: 'storage', kind: 'specific', goods: { stone: 24 } },
				variants: {
					extra: {
						construction: {
							goods: { steel: 3, stone: 5 },
							time: 6,
						},
						action: { type: 'storage', kind: 'specific', goods: { stone: 48 } },
					},
				},
			},
		},
	},
	freight_bay: {
		preparationTime: 1,
		action: { type: 'road-fret' },
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
		variants: {
			building: {
				construction: {
					goods: { wood: 3, stone: 3, planks: 2 },
					time: 8,
				},
				spec: { kind: 'building' },
			},
			research: {
				construction: {
					goods: { wood: 2, stone: 1, planks: 3 },
					time: 10,
				},
				spec: { kind: 'research' },
			},
			road: {
				construction: {
					goods: { wood: 3, stone: 5 },
					time: 8,
				},
				spec: { kind: 'road' },
			},
		},
	},

	// === New economy (target scheme) — harvest alveoli ====================
	deep_mine: {
		preparationTime: 2,
		action: { type: 'harvest', deposit: 'ore_seam', output: { iron_ore: 1, copper_ore: 1 } },
		workTime: 3,
		construction: { goods: { wood: 3, planks: 2, stone: 2 }, time: 6 },
	},
	coal_mine: {
		preparationTime: 2,
		action: { type: 'harvest', deposit: 'coal_seam', output: { coal: 1 } },
		workTime: 3,
		construction: { goods: { wood: 3, planks: 1, stone: 2 }, time: 6 },
	},
	tar_rig: {
		preparationTime: 2,
		action: { type: 'harvest', deposit: 'tar_pit', output: { crude_tar: 1 } },
		workTime: 3,
		construction: { goods: { wood: 3, stone: 2 }, time: 5 },
	},
	clay_pit: {
		preparationTime: 1,
		action: { type: 'harvest', deposit: 'clay_bed', output: { clay: 1 } },
		workTime: 2,
		construction: { goods: { wood: 1, stone: 1 }, time: 4 },
	},
	quarry_dredger: {
		preparationTime: 1,
		action: { type: 'harvest', deposit: 'sand_deposit', output: { silica_sand: 1 } },
		workTime: 2,
		construction: { goods: { wood: 2, planks: 1 }, time: 4 },
	},
	scrap_sorter: {
		preparationTime: 2,
		action: {
			type: 'harvest',
			deposit: 'scrapyard',
			output: { scrap_metal: 1, e_waste: 1, salvaged_parts: 1 },
		},
		workTime: 3,
		construction: { goods: { wood: 2, stone: 2, planks: 1 }, time: 5 },
	},
	water_well: {
		preparationTime: 1,
		action: { type: 'harvest', deposit: 'aquifer', output: { fresh_water: 1 } },
		workTime: 2,
		construction: { goods: { wood: 2, stone: 2 }, time: 4 },
	},

	// === New economy (target scheme) — transform alveoli ==================
	smelter: {
		preparationTime: 1,
		action: {
			type: 'transform',
			rates: { iron_ore: -0.2, copper_ore: -0.2, iron_ingot: 0.2, copper_ingot: 0.2 },
		},
		workTime: 2,
		construction: { goods: { wood: 3, stone: 4, planks: 1 }, time: 7 },
	},
	foundry: {
		preparationTime: 1,
		action: {
			type: 'transform',
			rates: { iron_ingot: -0.2, coal: -0.2, steel: 0.2 },
		},
		workTime: 2,
		construction: { goods: { wood: 3, stone: 4, planks: 2 }, time: 8 },
	},
	glass_kiln: {
		preparationTime: 1,
		action: {
			type: 'transform',
			rates: { silica_sand: -0.2, glass: 0.2 },
		},
		workTime: 2,
		construction: { goods: { wood: 2, stone: 3 }, time: 6 },
	},
	brick_kiln: {
		preparationTime: 1,
		action: {
			type: 'transform',
			rates: { clay: -0.2, bricks: 0.2 },
		},
		workTime: 2,
		construction: { goods: { wood: 2, stone: 3 }, time: 6 },
	},
	oil_press: {
		preparationTime: 1,
		action: {
			type: 'transform',
			rates: { wheat: -0.2, cooking_oil: 0.2 },
		},
		workTime: 2,
		construction: { goods: { wood: 2, planks: 1 }, time: 4 },
	},
	chemical_vat: {
		preparationTime: 1,
		action: {
			type: 'transform',
			rates: { wheat: -0.1, iron_ore: -0.1, fresh_water: -0.1, lye: 0.3 },
		},
		workTime: 2,
		construction: { goods: { wood: 3, stone: 3 }, time: 7 },
	},
	refinery: {
		preparationTime: 1,
		action: {
			type: 'transform',
			rates: { crude_tar: -0.2, refined_fuel: 0.2 },
		},
		workTime: 2,
		construction: { goods: { wood: 3, stone: 3, planks: 1 }, time: 7 },
	},
	forge: {
		preparationTime: 1,
		action: {
			type: 'transform',
			rates: {
				iron_ingot: -0.2,
				planks: -0.2,
				steel: -0.1,
				mechanical_parts: 0.2,
				shafts: 0.1,
				hand_tools: 0.2,
			},
		},
		workTime: 2,
		construction: { goods: { wood: 3, stone: 4 }, time: 8 },
	},
	machine_shop: {
		preparationTime: 1,
		action: {
			type: 'transform',
			rates: { steel: -0.2, iron_ingot: -0.1, powered_tools: 0.2 },
		},
		workTime: 2,
		construction: { goods: { wood: 3, stone: 4, planks: 2 }, time: 8 },
	},
	optics_workshop: {
		preparationTime: 1,
		action: {
			type: 'transform',
			rates: { copper_ingot: -0.2, glass: -0.2, circuits: 0.2, lenses: 0.1, precision_tools: 0.1 },
		},
		workTime: 2,
		construction: { goods: { wood: 3, stone: 3, planks: 2 }, time: 8 },
	},
	textile_atelier: {
		preparationTime: 1,
		action: {
			type: 'transform',
			rates: { wheat: -0.2, clothes: 0.2 },
		},
		workTime: 2,
		construction: { goods: { wood: 2, planks: 1 }, time: 5 },
	},
	soap_atelier: {
		preparationTime: 1,
		action: {
			type: 'transform',
			rates: { cooking_oil: -0.2, lye: -0.2, soap: 0.2 },
		},
		workTime: 2,
		construction: { goods: { wood: 2, stone: 2 }, time: 5 },
	},
	consumer_atelier: {
		preparationTime: 1,
		action: {
			type: 'transform',
			rates: { circuits: -0.2, glass: -0.1, lighting: 0.2 },
		},
		workTime: 2,
		construction: { goods: { wood: 2, planks: 2, stone: 1 }, time: 6 },
	},
	automation_factory: {
		preparationTime: 1,
		action: {
			type: 'transform',
			rates: { mechanical_parts: -0.2, circuits: -0.2, conveyors: 0.2 },
		},
		workTime: 2,
		construction: { goods: { wood: 3, stone: 3, planks: 3 }, time: 9 },
	},
} as const
