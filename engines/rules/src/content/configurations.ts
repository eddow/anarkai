/** Default configurations by action type (runtime typing lives in ssh). */
export const configurations = {
	'slotted-storage': {
		working: true,
		generalSlots: 0,
		goods: {},
	},
	'specific-storage': {
		working: true,
		buffers: {},
	},
	default: {
		working: true,
	},
} as const
