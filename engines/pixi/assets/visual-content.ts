export interface VisualDefinition {
	sprites?: string[]
	icon?: string
	background?: string
}

export const deposits: Record<string, VisualDefinition> = {
	berry_bush: {
		sprites: ['objects.bushes/bush1'],
	},
	rock: {
		sprites: [
			'objects.rocks/rock1',
			'objects.rocks/rock2',
			'objects.rocks/rock3',
			'objects.rocks/rock4',
			'objects.rocks/rock5',
			'objects.rocks/rock6',
		],
	},
	tree: {
		sprites: [
			'objects.trees/tree1',
			'objects.trees/tree2',
			'objects.trees/tree3',
			'objects.trees/tree4',
			'objects.trees/tree5',
			'objects.trees/tree6',
			'objects.trees/tree7',
			'objects.trees/tree8',
			'objects.trees/tree9',
			'objects.trees/tree10',
			'objects.trees/tree11',
		],
	},
}

export const alveoli: Record<string, VisualDefinition> = {
	tree_chopper: {
		sprites: ['buildings.chopper'],
		icon: 'buildings.chopper',
	},
	stonecutter: {
		sprites: ['buildings.cutter'],
		icon: 'buildings.cutter',
	},
	sawmill: {
		sprites: ['buildings.sawmill'],
		icon: 'buildings.sawmill',
	},
	storage: {
		sprites: ['buildings.store'],
		icon: 'buildings.store',
	},
	engineer: {
		sprites: ['buildings.engineer'],
		icon: 'buildings.engineer',
	},
	woodpile: {
		sprites: ['buildings.woodpile'],
		icon: 'buildings.woodpile',
	},
	freight_bay: {
		// Freight bays replace the old visible gather-stop role.
		sprites: ['buildings.load'],
		icon: 'buildings.load',
	},
}

export const goods: Record<string, VisualDefinition> = {
	berries: {
		sprites: ['goods.berries'],
		icon: 'goods.berries',
	},
	mushrooms: {
		sprites: ['goods.mushrooms'],
		icon: 'goods.mushrooms',
	},
	planks: {
		sprites: ['goods.planks'],
		icon: 'goods.planks',
	},
	stone: {
		sprites: ['goods.stone'],
		icon: 'goods.stone',
	},
	wood: {
		sprites: ['goods.wood'],
		icon: 'goods.wood',
	},
}

export const vehicles: Record<string, VisualDefinition> = {
	wheelbarrow: {
		sprites: ['vehicles.wheelbarrow'],
	},
}

export const terrain: Record<string, VisualDefinition> = {
	water: {}, // TODO: Add visual details
	forest: {},
	rocky: { background: 'terrain.stone' },
	grass: {},
	concrete: { background: 'terrain.concrete' }, // Inferred from Alveolus code
	sand: {},
	snow: {},
}

export const characters: Record<string, VisualDefinition> = {
	default: {
		sprites: ['characters.default'],
	},
}

export const commands: Record<string, VisualDefinition> = {
	click: {
		sprites: ['commands.click'],
	},
}

/** River body PNGs (served from `/pixi-assets/rivers/*.png`). */
export const rivers: Record<string, VisualDefinition> = {
	bodies: {
		sprites: [
			'rivers.body_straight_180__narrow',
			'rivers.body_straight_180__medium',
			'rivers.body_straight_180__wide',
			'rivers.body_bend_60__narrow',
			'rivers.body_bend_60__medium',
			'rivers.body_bend_60__wide',
			'rivers.body_bend_120__narrow',
			'rivers.body_bend_120__medium',
			'rivers.body_bend_120__wide',
		],
	},
	terminals: {
		sprites: [
			'rivers.terminal_source__narrow',
			'rivers.terminal_source__medium',
			'rivers.terminal_source__wide',
			'rivers.terminal_pool__narrow',
			'rivers.terminal_pool__medium',
			'rivers.terminal_pool__wide',
			'rivers.terminal_mouth__narrow',
			'rivers.terminal_mouth__medium',
			'rivers.terminal_mouth__wide',
			'rivers.terminal_delta__narrow',
			'rivers.terminal_delta__medium',
			'rivers.terminal_delta__wide',
		],
	},
	junctions: {
		sprites: [
			'rivers.junction_y_120__narrow',
			'rivers.junction_y_120__medium',
			'rivers.junction_y_120__wide',
			'rivers.junction_arc_stub__narrow',
			'rivers.junction_arc_stub__medium',
			'rivers.junction_arc_stub__wide',
			'rivers.junction_skew__narrow',
			'rivers.junction_skew__medium',
			'rivers.junction_skew__wide',
			'rivers.junction_4a__narrow',
			'rivers.junction_4a__medium',
			'rivers.junction_4a__wide',
			'rivers.junction_4b__narrow',
			'rivers.junction_4b__medium',
			'rivers.junction_4b__wide',
			'rivers.junction_4c__narrow',
			'rivers.junction_4c__medium',
			'rivers.junction_4c__wide',
			'rivers.junction_5way__narrow',
			'rivers.junction_5way__medium',
			'rivers.junction_5way__wide',
			'rivers.junction_6hub__narrow',
			'rivers.junction_6hub__medium',
			'rivers.junction_6hub__wide',
		],
	},
}

/** Non-alveolus tile content sprites (served from `/pixi-assets/buildings/*.png`). */
export const dwellings: Record<string, VisualDefinition> = {
	basic_dwelling: {
		sprites: ['buildings.cabin'],
		icon: 'buildings.cabin',
		background: 'buildings.cabin',
	},
}

export const visualContent = {
	deposits,
	alveoli,
	goods,
	vehicles,
	terrain,
	characters,
	commands,
	rivers,
	dwellings,
}
