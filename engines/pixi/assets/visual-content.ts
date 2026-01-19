export interface VisualDefinition {
	sprites?: string[];
	icon?: string;
	background?: string;
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
};

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
	gather: {
		sprites: ['buildings.load'], // Temporary: transit.png missing
		icon: 'buildings.load',
	},
	engineer: {
		sprites: ['buildings.engineer'],
		icon: 'buildings.engineer',
	},
	woodpile: {
		sprites: ['buildings.woodpile'],
		icon: 'buildings.woodpile',
	},
};

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
};

export const vehicles: Record<string, VisualDefinition> = {
	'by-hands': {
		sprites: ['vehicles.byHands'],
	},
};

export const terrain: Record<string, VisualDefinition> = {
	water: {}, // TODO: Add visual details
	forest: {},
	rocky: { background: 'terrain.stone' },
	grass: {},
	concrete: { background: 'terrain.concrete' }, // Inferred from Alveolus code
	sand: {},
	snow: {},
};

export const characters: Record<string, VisualDefinition> = {
	default: {
		sprites: ['characters.default'],
	},
};

export const commands: Record<string, VisualDefinition> = {
	click: {
		sprites: ['commands.click'],
	},
};

export const visualContent = {
	deposits,
	alveoli,
	goods,
	vehicles,
	terrain,
    characters,
    commands,
};
