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
	transform: {
		working: true,
		productRatio: undefined,
	},
	default: {
		working: true,
	},
} as const
