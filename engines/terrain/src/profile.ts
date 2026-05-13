export function isTerrainProfileEnabled(): boolean {
	const globalFlag = (globalThis as unknown as { __ANARKAI_WASM_PROFILE__?: boolean })
		.__ANARKAI_WASM_PROFILE__
	if (globalFlag !== undefined) return globalFlag
	try {
		return (
			(globalThis as unknown as { localStorage?: { getItem(key: string): string | null } })
				.localStorage?.getItem('anarkai.wasmProfile') === '1'
		)
	} catch {
		return false
	}
}

export function logTerrainProfile(message: string): void {
	if (isTerrainProfileEnabled()) console.log(message)
}
