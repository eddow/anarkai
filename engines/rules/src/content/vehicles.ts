export const vehicles = {
	'by-hands': {
		storage: { capacity: 1, slots: 2 },
		walkTime: 1, // Time to walk by foot
		transferTime: 1.5, // Slightly slower so hand-offs remain visible
	},
} as const
