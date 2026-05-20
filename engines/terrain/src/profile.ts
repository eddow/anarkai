export const TERRAIN_WASM_PROFILE_ENABLED = false

export function isTerrainProfileEnabled(): boolean {
	return TERRAIN_WASM_PROFILE_ENABLED
}

export function logTerrainProfile(message: string): void {
	if (isTerrainProfileEnabled()) console.log(message)
}
