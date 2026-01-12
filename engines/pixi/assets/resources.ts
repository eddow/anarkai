export const prefix = '/assets/'

// ResourceTree type definition
export interface ResourceTree {
	[key: string]: ResourceTree | string
}

// Note: resources are now organized as a tree structure
export const resources: ResourceTree = {
	objects: {
		rocks: 'objects/rocks.json',
		trees: 'objects/trees.json',
		bushes: 'objects/bushes.json',
	},
	terrain: {
		rocky: 'terrain/stone.jpg',
		grass: 'terrain/grass.jpg',
		forest: 'terrain/forest.jpg',
		water: 'terrain/water.jpg',
		sand: 'terrain/sand.jpg',
		snow: 'terrain/snow.jpg',
		concrete: 'terrain/concrete.jpg',
	},
	buildings: {
		cabin: 'buildings/cabin.png',
		chopper: 'buildings/chopper.png',
		cutter: 'buildings/cutter.png',
		sawmill: 'buildings/sawmill.png',
		transit: 'buildings/load.png',
		store: 'buildings/store.png',
		shop: 'buildings/shop.png',
		construction: 'buildings/trowel.png',
		engineer: 'buildings/engineer.png',
		bulldozer: 'buildings/bulldozer.png',
	},
	goods: {
		berries: 'goods/berries.png',
		mushrooms: 'goods/mushrooms.png',
		planks: 'goods/planks.png',
		wood: 'goods/wood.png',
		stone: 'goods/stone.png',
	},
	commands: {
		select: 'commands/click.png',
	},
	character: 'character.png',
	vehicles: {
		byHands: 'vehicles/by-hands.png',
	},
}
