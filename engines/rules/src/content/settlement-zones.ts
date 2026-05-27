export const settlementZones = {
	village: {
		radius: 3,
		target: { civic: 0.05, residential: 0.7, commercial: 0.15, industrial: 0.1 },
		civicMax: 1,
		parcelDensity: 0.78,
		fringeResidentialRings: 1,
	},
	town: {
		radius: 4,
		target: { civic: 0.04, residential: 0.6, commercial: 0.25, industrial: 0.11 },
		civicMax: 1,
		parcelDensity: 0.84,
		fringeResidentialRings: 1,
	},
	city: {
		radius: 5,
		target: { civic: 0.03, residential: 0.55, commercial: 0.3, industrial: 0.12 },
		civicMax: 1,
		parcelDensity: 0.9,
		fringeResidentialRings: 2,
	},
} as const
