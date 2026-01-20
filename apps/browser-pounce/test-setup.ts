// Basic test setup for ssh project
// This file is required by vitest.config.ts

import { vi } from 'vitest'

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
