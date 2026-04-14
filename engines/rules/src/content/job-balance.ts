export const jobBalance = {
	offload: {
		projectTile: 15,
		alveolusBlocked: 4,
		residentialTile: 1.25,
	},
	convey: 3,
	gather: 2,
	harvest: {
		project: 2,
		clearing: 1.5,
		fallbackBase: 0.25,
		needsBonus: 0.5,
	},
	transform: 2,
	engineer: {
		foundation: 3,
		construct: 2,
	},
	defragment: 0.9,
} as const
