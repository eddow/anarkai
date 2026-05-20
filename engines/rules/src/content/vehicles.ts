/** Axial distance within which idle vehicles may consider vehicle-offload burdened tiles. */
export const offloadRange = 6

export const vehicles = {
	/** Line freight carrier (world `VehicleEntity` + operated storage when driving). */
	wheelbarrow: {
		storage: { capacity: 1, slots: 2 },
		walkTime: 1.45,
		transferTime: 1.5,
	},
	pickup_truck: {
		storage: { capacity: 3, slots: 2 },
		walkTime: 0.85,
		transferTime: 1,
	},
} as const
