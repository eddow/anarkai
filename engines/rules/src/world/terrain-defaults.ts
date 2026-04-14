/**
 * Default terrain field + hydrology budget parameters.
 * Must stay assignable to `TerrainConfig` in engine-terrain (validated at re-export site).
 */
export const defaultTerrainConfig = {
	scale: 0.05,
	terrainTypeScale: 1.2,
	octaves: 5,
	persistence: 0.6,
	lacunarity: 2.2,
	temperatureScale: 0.08,
	humidityScale: 0.08,
	seaLevel: -0.04,
	snowLevel: 0.16,
	rockyLevel: 0.11,
	forestLevel: -0.02,
	sandTemperature: 0.15,
	sandHumidity: -0.05,
	wetlandHumidity: 0.15,
	forestHumidity: 0.03,
	hydrologySourcesPerTile: 0.1,
	hydrologyLandCeiling: 0.2,
	hydrologyMaxTraceSteps: 64,
	hydrologyFluxStepWeight: 6,
} as const
