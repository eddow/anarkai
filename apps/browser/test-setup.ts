// Basic test setup for ssh project
// This file is required by vitest.config.ts

import { sursautOptions } from '@sursaut/core'

import { mountHeadContent, setPlatform } from '@sursaut/kit'
import { reactive } from 'mutts'
import { vi } from 'vitest'

// Mock debugObjectId with stable obj:N IDs.
// Objects may carry a .uid property used for game object identity lookup
// (e.g. game.objects lookup by uid in follow-selection, LinkedEntityControl).
// This mock prefers .uid when present to let tests control identity,
// then falls back to auto-generated obj:N for objects without .uid.
let _debugObjectIdCounter = 1
vi.mock('ssh/dev/debug-object-id', () => {
	const _debugObjectIds = new WeakMap<object, string>()
	function _objectIdFor(value: object): string {
		let id = _debugObjectIds.get(value)
		if (!id) {
			id = `obj:${_debugObjectIdCounter++}`
			_debugObjectIds.set(value, id)
		}
		return id
	}
	return {
		debugObjectId: (obj: unknown) => {
			if (obj && typeof obj === 'object' && 'uid' in obj && typeof (obj as any).uid === 'string') {
				return (obj as any).uid
			}
			if (obj && (typeof obj === 'object' || typeof obj === 'function')) {
				return _objectIdFor(obj)
			}
			return undefined
		},
		debugRawObjectId: (obj: unknown) => {
			if (obj && typeof obj === 'object' && 'uid' in obj && typeof (obj as any).uid === 'string') {
				return (obj as any).uid
			}
			if (obj && (typeof obj === 'object' || typeof obj === 'function')) {
				return _objectIdFor(obj)
			}
			return undefined
		},
		resetDebugObjectIds: vi.fn(),
	}
})

const url = new URL('http://localhost/')

setPlatform({
	client: reactive({
		url: {
			href: url.href,
			origin: url.origin,
			pathname: url.pathname,
			search: url.search,
			hash: url.hash,
			segments: [],
			query: {},
		},
		viewport: { width: 1920, height: 1080 },
		history: { length: 1, navigation: 'load' },
		focused: false,
		visibilityState: 'hidden',
		devicePixelRatio: 1,
		online: true,
		language: 'en-US',
		timezone: 'UTC',
		direction: 'ltr',
		prefersDark: false,
		navigate() {
			throw new Error('client.navigate() is not available in test context')
		},
		replace() {
			throw new Error('client.replace() is not available in test context')
		},
		reload() {
			throw new Error('client.reload() is not available in test context')
		},
		dispose() {},
	}),
	mountHead: (content, env) => mountHeadContent(document.head, content, env),
})

// Plain-object module mocks do not trigger mutts `touched`; Sursaut would false-positive `checkReactivity` warnings on bidi props.
sursautOptions.checkReactivity = false

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
