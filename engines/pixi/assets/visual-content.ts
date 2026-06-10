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
	wheat_crop: {
		sprites: ['objects.bushes/bush1'],
	},
}

export const alveoli: Record<string, VisualDefinition> = {
	construction_site: {
		sprites: ['buildings.trowel'],
		icon: 'buildings.trowel',
	},
	forester: {
		sprites: ['buildings.forester'],
		icon: 'buildings.forester',
	},
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
	wheat_planter: {
		sprites: ['buildings.wheat-planter'],
		icon: 'buildings.wheat-planter',
	},
	wheat_harvester: {
		sprites: ['buildings.chopper'],
		icon: 'buildings.chopper',
	},
	flour_mill: {
		sprites: ['buildings.flour-mill'],
		icon: 'buildings.flour-mill',
	},
	bakery: {
		sprites: ['buildings.bakery'],
		icon: 'buildings.bakery',
	},
	restaurant: {
		sprites: ['buildings.shop'],
		icon: 'buildings.shop',
	},
	storage: {
		sprites: ['buildings.store'],
		icon: 'buildings.store',
	},
	engineer: {
		sprites: ['buildings.engineer'],
		icon: 'buildings.engineer',
	},
	freight_bay: {
		// Freight bays replace the old visible gather-stop role.
		sprites: ['buildings.load'],
		icon: 'buildings.load',
	},
	pile: {
		sprites: ['buildings.pile-of'],
		icon: 'buildings.pile-of',
	},
}

/** Badge sprites for alveolus variants (overlaid on root icon). */
export const variantBadges: Record<string, VisualDefinition> = {
	// Pile variant badges — reuse goods icons
	'pile.wood': {
		sprites: ['goods.wood'],
		icon: 'goods.wood',
	},
	'pile.planks': {
		sprites: ['goods.planks'],
		icon: 'goods.planks',
	},
	'pile.stone': {
		sprites: ['goods.stone'],
		icon: 'goods.stone',
	},
	// "Extra" tier badges — medalion with good icon
	'pile.wood.extra': {
		sprites: ['variants.extra-wood'],
		icon: 'variants.extra-wood',
	},
	'pile.planks.extra': {
		sprites: ['variants.extra-planks'],
		icon: 'variants.extra-planks',
	},
	'pile.stone.extra': {
		sprites: ['variants.extra-stone'],
		icon: 'variants.extra-stone',
	},
	// Engineer variant badges
	'engineer.building': {
		sprites: ['buildings.trowel'],
		icon: 'buildings.trowel',
	},
	'engineer.research': {
		sprites: ['buildings.variant-building'],
		icon: 'buildings.variant-building',
	},
	'engineer.road': {
		sprites: ['variants.road'],
		icon: 'variants.road',
	},
}

export const goods: Record<string, VisualDefinition> = {
	berries: {
		sprites: ['goods.berries'],
		icon: 'goods.berries',
	},
	sandwich: {
		sprites: ['goods.berries'],
		icon: 'goods.berries',
	},
	concrete: {
		sprites: ['goods.cement'],
		icon: 'goods.cement',
	},
	charcoal: {
		sprites: ['goods.stone'],
		icon: 'goods.stone',
	},
	clothes: {
		sprites: ['goods.planks'],
		icon: 'goods.planks',
	},
	mushrooms: {
		sprites: ['goods.mushrooms'],
		icon: 'goods.mushrooms',
	},
	sunglasses: {
		sprites: ['goods.planks'],
		icon: 'goods.planks',
	},
	wheat: {
		sprites: ['goods.wheat'],
		icon: 'goods.wheat',
	},
	flour: {
		sprites: ['goods.flour'],
		icon: 'goods.flour',
	},
	bread: {
		sprites: ['goods.bread'],
		icon: 'goods.bread',
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
	pickup_truck: {
		sprites: ['vehicles.pickupTruck'],
	},
	suv: {
		sprites: ['vehicles.suv'],
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

export interface RoadVisualDefinition {
	tileTexturePixels: number
	tileTextureWorldSizeTileSideMultiplier: number
	pathWidthTileSideMultiplier: number
	materialWorldSizePathWidthMultiplier: number
	edgeFadeTileSideMultiplier: number
	texture: string
	fallbackRgb: readonly [number, number, number]
	macro: {
		color: string
		widthMultiplier: number
		alpha: number
	}
	line: {
		color: string
		width: number
		alpha: number
	}
}

export interface RoadVisualContent {
	types: Record<string, RoadVisualDefinition>
}

export const roads: RoadVisualContent = {
	types: {
		path: {
			tileTexturePixels: 96,
			tileTextureWorldSizeTileSideMultiplier: 2,
			pathWidthTileSideMultiplier: 1,
			materialWorldSizePathWidthMultiplier: 2,
			edgeFadeTileSideMultiplier: 0.14,
			texture: 'roads.brick_moss',
			fallbackRgb: [116, 83, 53],
			macro: {
				color: '#a9784d',
				widthMultiplier: 1,
				alpha: 0.78,
			},
			line: {
				color: '#9b7048',
				width: 5,
				alpha: 0.82,
			},
		},
		asphalt: {
			tileTexturePixels: 96,
			tileTextureWorldSizeTileSideMultiplier: 2,
			pathWidthTileSideMultiplier: 1,
			materialWorldSizePathWidthMultiplier: 2,
			edgeFadeTileSideMultiplier: 0.14,
			texture: 'roads.asphalt',
			fallbackRgb: [86, 88, 86],
			macro: {
				color: '#55585a',
				widthMultiplier: 1.2,
				alpha: 0.78,
			},
			line: {
				color: '#55585a',
				width: 6,
				alpha: 0.82,
			},
		},
	},
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
	bulldoze: {
		sprites: ['buildings.bulldozer'],
		icon: 'buildings.bulldozer',
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

export const settlementTargets: Record<string, VisualDefinition> = {
	city_hall: {
		sprites: ['buildings.city-hall'],
		icon: 'buildings.city-hall',
	},
}

export const visualContent = {
	deposits,
	alveoli,
	goods,
	vehicles,
	terrain,
	roads,
	characters,
	commands,
	dwellings,
	settlementTargets,
	variantBadges,
}
