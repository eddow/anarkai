/**
 * Bridge between engines/ssh and engines/core (Rust/WASM).
 *
 * In browser: uses the default async init which fetches the `.wasm` file via URL.
 * In Node/Vitest: uses `initSync` with raw bytes read from disk via `node:fs`.
 *
 * The Node code path uses direct `import('node:*')` — Vitest supports this.
 * TypeScript errors on `node:*` imports in the browser tsconfig are suppressed
 * with `@ts-ignore` since this code only executes in Node.
 */

import type { InitOutput } from 'anarkai-core'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any

let wasm: InitOutput | null = null

/**
 * Initialize the WASM core (idempotent).
 * Must be called before any WASM functions are used.
 */
export async function initCore(): Promise<InitOutput> {
	if (wasm) return wasm

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

		// From engines/ssh/src/lib/, go up 3 to engines/, then core/pkg/
		const wasmPath = nodePath.join(
			nodePath.dirname(nodeUrl.fileURLToPath(import.meta.url)),
			'..', '..', '..', 'core', 'pkg', 'anarkai_core_bg.wasm',
		)
		const bytes = nodeFs.readFileSync(wasmPath)
		const core = await import('anarkai-core')
		wasm = core.initSync(bytes) as InitOutput
		return wasm
	}

	// Browser: default async init fetches the .wasm file
	const core = await import('anarkai-core')
	wasm = await core.default() as InitOutput
	return wasm
}

/**
 * Call the WASM `add` function (u32 → u32).
 * Verifies WASM integration end-to-end.
 */
export async function wasmAdd(a: number, b: number): Promise<number> {
	await initCore()
	const { add } = await import('anarkai-core')
	return add(a, b)
}

/** Check whether WASM is available in this runtime. */
export function isWasmAvailable(): boolean {
	try {
		return typeof WebAssembly !== 'undefined'
	} catch {
		return false
	}
}
