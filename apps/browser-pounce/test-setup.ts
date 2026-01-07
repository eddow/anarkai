// Basic test setup for ssh project
// This file is required by vitest.config.ts

import { vi } from 'vitest'

// Setup global test functions for vitest
// @ts-ignore - Adding global test functions
globalThis.describe = vi.describe
// @ts-ignore - Adding global test functions  
globalThis.it = vi.it
// @ts-ignore - Adding global test functions
globalThis.expect = vi.expect
// @ts-ignore - Adding global test functions
globalThis.beforeEach = vi.beforeEach
// @ts-ignore - Adding global test functions
globalThis.afterEach = vi.afterEach
// @ts-ignore - Adding global test functions
globalThis.beforeAll = vi.beforeAll
// @ts-ignore - Adding global test functions
globalThis.afterAll = vi.afterAll
