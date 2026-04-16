export const jobBalance = {
	offload: {
		projectTile: 15,
		alveolusBlocked: 4,
		residentialTile: 1.25,
	},
	convey: 3,
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
	/** Walk to a wheelbarrow and board (line freight). */
	vehicleApproach: 2.0,
	/** Attach line service after boarding (no movement). */
	vehicleBeginService: 2.07,
	/** Pick up loose goods into the operated vehicle (gather zone). */
	loadOntoVehicle: 2.15,
	/** Move goods from operated vehicle into bay storage (gather unload anchor). */
	unloadFromVehicle: 2.16,
	/** Provide goods from operated vehicle into a standalone construction site (active need sink). */
	provideFromVehicle: 2.25,
	/** Move along a freight line while operating a vehicle (hop to next meaningful tile/stop). */
	vehicleHop: 2.1,
	defragment: 0.9,
} as const
