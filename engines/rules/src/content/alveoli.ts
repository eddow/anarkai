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
			productRatio: { inputGood: 'wood', outputGood: 'planks', maxProductRatio: 0.5 },
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
			productRatio: { inputGood: 'wheat', outputGood: 'flour', maxProductRatio: 0.6 },
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
			productRatio: { inputGood: 'flour', outputGood: 'bread', maxProductRatio: 0.7 },
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
			productRatio: { inputGood: 'berries', outputGood: 'sandwich', maxProductRatio: 0.65 },
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
          goods: { wood: 10 },
          time: 4,
        },
        action: { type: 'storage', kind: 'specific', goods: { wood: 24 } },
        variants: {
          extra: {
            construction: {
              goods: { wood: 15, planks: 5 },
              time: 6,
            },
            action: { type: 'storage', kind: 'specific', goods: { wood: 48 } },
          },
        },
      },
      planks: {
        construction: {
          goods: { wood: 10, planks: 5 },
          time: 4,
        },
        action: { type: 'storage', kind: 'specific', goods: { planks: 24 } },
        variants: {
          extra: {
            construction: {
              goods: { wood: 15, planks: 10 },
              time: 6,
            },
            action: { type: 'storage', kind: 'specific', goods: { planks: 48 } },
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
} as const
