export const jobBalance = {
	priorityTier: {
		/** Gather now, and the same pickup also clears a project / offload burden. */
		lineAndOffloadJoint: 1.35,
		/** Pure maintenance / offload follow-up without a simultaneous line pickup. */
		pureOffload: 1.1,
		/** Baseline line-only pickup / transfer. */
		pureLine: 1,
	},
	offload: {
		/**
		 * Loose-good loads (un-burdening) must dominate line service: scoring is
		 * `urgency / (pathLength + 1)`, so to keep un-burden ~10× more important than
		 * {@link jobBalance.vehicleHop} (`2.1`) at any reachable path, every load tier sits ≥ 21
		 * (`10 * 2.1`). Tiers stay ordered project > alveolus > residential by burdening severity.
		 */
		projectTile: 30,
		alveolusBlocked: 25,
		residentialTile: 21,
		/** Drop loaded cargo from an idle wheelbarrow onto a non-burdening tile. */
		unloadToTile: 8,
		/**
		 * Move an empty burdening wheelbarrow off a docked / idle hex. Set high enough that
		 * `urgency / (pathLength + 1)` outranks {@link jobBalance.vehicleHop} at any path within
		 * {@link offloadRange}: 2.1 * (6 + 2) = 16.8 → 17.
		 */
		park: 17,
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
