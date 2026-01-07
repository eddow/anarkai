// Gameplay mechanics constants
// These control character behavior, survival mechanics, and game balance

export const characterEvolutionRates: {
	[k in Ssh.NeedType]: Partial<Record<Ssh.ActivityType, number>> & { '*': number }
} = {
	// Need evolution per activity, with '*' as default fallback
	hunger: {
		'*': 2,
		walk: 8,
		work: 12,
		eat: 0,
	} as const,
	tiredness: {
		'*': 2,
		walk: 5,
		work: 8,
		sleep: 0,
	} as const,
	fatigue: {
		'*': 0,
		walk: 3,
		work: 5,
	} as const,
} as const

export const characterTriggerLevels = {
	hunger: {
		high: 700,
		critical: 1000,
		satisfied: 300,
	},
	tiredness: {
		high: 2100,
		critical: 2500,
		satisfied: 100,
	},
	fatigue: {
		high: 140,
		critical: 180,
		satisfied: 10,
	},
} as const

export const activityDurations = {
	handTransfer: 1, // Time to grab/drop items by hand
	footWalkTime: 1, // Time to walk by foot
	eating: 2, // Time to eat food
	restMin: 3,
	restMax: 6,
} as const

export const ponderingFatigueRecovery = 60 // Fatigue recovery rate while resting
export const maxWalkTime = 24 // Maximum walking time accepted to choose a tile for an action

// Storage and building constants
export const transformAlveolusStorageMultiplier = 3 // Transform alveoli can store input goods * this multiplier
// Storage buffer sizes for transform/harvest
export const inputBufferSize = 2
export const outputBufferSize = 3
