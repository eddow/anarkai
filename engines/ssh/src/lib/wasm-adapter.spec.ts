/**
 * Smoke test: verify the WASM core engine can be initialized and the `add`
 * function works in Node.js/Vitest.
 */
import { describe, expect, test } from 'vitest'
import { initCore, isWasmAvailable, wasmAdd } from './wasm-adapter'

describe('WASM core integration', () => {
	test('WASM is available in Node.js', () => {
		expect(isWasmAvailable()).toBe(true)
	})

	test('initCore loads the WASM module', async () => {
		const wasm = await initCore()
		expect(wasm).toBeDefined()
		expect(wasm.memory).toBeDefined()
	})

	test('wasmAdd returns correct sum', async () => {
		expect(await wasmAdd(2, 3)).toBe(5)
		expect(await wasmAdd(0, 0)).toBe(0)
		expect(await wasmAdd(1_000_000, 2_000_000)).toBe(3_000_000)
	})

	test('initCore is idempotent', async () => {
		const a = await initCore()
		const b = await initCore()
		expect(a).toBe(b)
	})
})
