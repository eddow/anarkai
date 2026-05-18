/**
 * Central WASM module loader and cache.
 * Loads the anarkai-core WASM module once and makes it available to all terrain functions.
 *
 * WASM loading begins eagerly when this module is imported.
 * In browser: uses the default async init which fetches the `.wasm` file via URL.
 * In Node/Vitest: uses `initSync` with raw bytes read from disk via `node:fs`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any

let wasmModule: any = null
let wasmLoadPromise: Promise<any> | null = null

function trace(channel: string, level: 'log' | 'warn', message: string, ...args: unknown[]): void {
	try {
		const method = console[level] as (...args: unknown[]) => void
		method(`[wasm:${channel}] ${message}`, ...args)
	} catch {
		// noop if console not available
	}
}

/**
 * Load the WASM module (cached after first call).
 * In Node.js/Vitest: uses initSync with file-system buffer
 * In browser: default async init fetches the .wasm file
 */
export async function loadWasmModule(): Promise<any> {
	// Return cached module if already loaded
	if (wasmModule) {
		return wasmModule
	}

	// Return existing promise if loading in progress
	if (wasmLoadPromise) {
		return wasmLoadPromise
	}

	// Start loading
	wasmLoadPromise = (async () => {
		try {
			const core = await import('anarkai-core')

			// In Node.js/Vitest, use initSync with file-system buffer
			if (
				// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
				typeof process !== 'undefined' &&
				typeof process?.versions?.node === 'string'
			) {
				// @ts-ignore: node: imports only resolve in Node/Vitest, not browser builds
				const nodeFs = await import('node:fs')
				// @ts-ignore: node: imports only resolve in Node/Vitest, not browser builds
				const nodePath = await import('node:path')
				// @ts-ignore: node: imports only resolve in Node/Vitest, not browser builds
				const nodeUrl = await import('node:url')

				// From engines/terrain/src/, go up 2 to engines/, then core/pkg/
				// @ts-ignore
				const wasmPath = nodePath.join(
					nodePath.dirname(nodeUrl.fileURLToPath(import.meta.url)),
					'..', '..', 'core', 'pkg', 'anarkai_core_bg.wasm',
				)
				const bytes = nodeFs.readFileSync(wasmPath)
				core.initSync(bytes)
				wasmModule = core
			} else {
				// Browser: default async init fetches the .wasm file
				await core.default()
				wasmModule = core
			}

			trace('loader', 'log', 'WASM module loaded successfully', {
				exportCount: Object.keys(wasmModule).filter(k => typeof wasmModule[k] === 'function').length,
			})
			return wasmModule
		} catch (e) {
			trace('loader', 'warn', 'Failed to load WASM module; terrain will use CPU fallback', e)
			// Reset promise on error so we can retry
			wasmLoadPromise = null
			throw e
		}
	})()

	return wasmLoadPromise
}

/**
 * Get the loaded WASM module (returns null if not loaded yet).
 * If WASM hasn't been loaded yet, triggers a one-time warning and eager load.
 */
export function getWasmModule(): any {
	if (wasmModule) {
		return wasmModule
	}
	throw new Error('WASM module not loaded — terrain generation requires WASM. Call loadWasmModule() first.')
}

/**
 * Check if WASM module is loaded.
 */
export function isWasmLoaded(): boolean {
	return wasmModule !== null
}

/**
 * Wait for WASM to be loaded (no-op if already loaded).
 */
export async function ensureWasmLoaded(): Promise<void> {
	if (wasmModule) {
		return
	}
	await loadWasmModule()
}

/**
 * Reset the fallback warning (called after WASM loads successfully).
 */
export function resetFallbackWarning(): void {
	// Kept for callers that still reset the old one-shot fallback warning state.
}

// Eagerly start WASM loading on module import.
// Game initialization MUST await this before generating any terrain.
export const wasmLoadReady: Promise<any> = loadWasmModule()
