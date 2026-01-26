// Basic test setup for ssh project
// This file is required by vitest.config.ts

import { vi } from 'vitest'
import { reactiveOptions, unreactive } from 'mutts'

// Ensure memoization discrepancies throw error in tests
let inDiscrepancy = false
reactiveOptions.onMemoizationDiscrepancy = (cached, fresh, fn: any, args, cause) => {
	if (inDiscrepancy) return
	inDiscrepancy = true
	try {
		// Fast pass: same target object
		if (unreactive(cached) === unreactive(fresh)) return

		// Second pass: deep equality via safe JSON
		const safeStringify = (val: any, indent?: number) => {
			const seen = new WeakSet()
			try {
				return JSON.stringify(
					val,
					(key, value) => {
						if (typeof value === 'object' && value !== null) {
							if (seen.has(value)) return '[Circular]'
							seen.add(value)
						}
						return value
					},
					indent,
				)
			} catch {
				return `[Unserializable: ${val?.constructor?.name || typeof val}]`
			}
		}

		const cachedJson = safeStringify(cached)
		const freshJson = safeStringify(fresh)
		if (cachedJson === freshJson) return

		const methodName = fn?.name || fn?.key || 'unknown'
		const className = fn?.owner?.name || fn?.owner?.constructor?.name || ''
		const message = `Memoization discrepancy in ${className ? `${className}.` : ''}${methodName}`
		console.error('\x1b[31m' + message + '\x1b[0m')

		console.error('Cached:', safeStringify(cached, 2))
		console.error('Fresh:', safeStringify(fresh, 2))
		console.error('Cause:', cause)
		const owner = args?.[0]
		if (owner) {
			console.error('Owner state:', safeStringify(owner, 2))
		}
		throw new Error(message)
	} finally {
		inDiscrepancy = false
	}
}

// Setup global test functions for vitest
// @ts-expect-error - Adding global test functions
globalThis.describe = vi.describe
// @ts-expect-error - Adding global test functions
globalThis.it = vi.it
// @ts-expect-error - Adding global test functions
globalThis.expect = vi.expect
// @ts-expect-error - Adding global test functions
globalThis.beforeEach = vi.beforeEach
// @ts-expect-error - Adding global test functions
globalThis.afterEach = vi.afterEach
// @ts-expect-error - Adding global test functions
globalThis.beforeAll = vi.beforeAll
// @ts-expect-error - Adding global test functions
globalThis.afterAll = vi.afterAll

// Mock browser environment for PixiJS
if (typeof Node === 'undefined') {
	;(global as any).Node = class {}
}
if (typeof Element === 'undefined') {
	;(global as any).Element = class {}
}
if (typeof HTMLElement === 'undefined') {
	;(global as any).HTMLElement = class {}
}
if (typeof SVGElement === 'undefined') {
	;(global as any).SVGElement = class {}
}
if (typeof CustomEvent === 'undefined') {
	;(global as any).CustomEvent = class {}
}
if (typeof document === 'undefined') {
	;(global as any).document = {
		createElement: () => ({
			getContext: () => ({
				fillRect: () => {},
				drawImage: () => {},
				getImageData: () => ({ data: [] }),
				measureText: () => ({ width: 0 }),
				getParameter: () => 0,
				getExtension: () => ({}),
			}),
			canPlayType: () => '',
			width: 100,
			height: 100,
			addEventListener: () => {},
		}),
		body: { appendChild: () => {}, removeChild: () => {} },
	}
	;(global as any).document.baseURI = 'http://localhost/'
}
if (typeof window === 'undefined') {
	;(global as any).window = {
		addEventListener: () => {},
		removeEventListener: () => {},
		navigator: { userAgent: 'node' },
		requestAnimationFrame: (cb: any) => setTimeout(cb, 16),
		document: (global as any).document,
	}
	// Bind window to global if needed by some libs, but usually window.X access works if window is defined
}
if (typeof navigator === 'undefined') {
	;(global as any).navigator = { userAgent: 'node' }
}
if (typeof requestAnimationFrame === 'undefined') {
	;(global as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 16)
}
if (typeof Image === 'undefined') {
	;(global as any).Image = class {
		_src = ''
		onload: any
		onerror: any
		set src(val: string) {
			this._src = val
			setTimeout(() => this.onload && this.onload(), 1)
		}
		get src() {
			return this._src
		}
	}
}
if (typeof fetch === 'undefined' || true) {
	;(global as any).fetch = () =>
		Promise.resolve({
			ok: true,
			status: 200, // Added status for robustness
			json: () => Promise.resolve({}),
			blob: () => Promise.resolve(new Blob()),
			text: () => Promise.resolve(''),
		})
}
if (typeof localStorage === 'undefined') {
	;(global as any).localStorage = {
		getItem: () => null,
		setItem: () => {},
		removeItem: () => {},
		clear: () => {},
	}
}
