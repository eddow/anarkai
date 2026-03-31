// Basic test setup for ssh project
// This file is required by vitest.config.ts

import { sursautOptions } from "@sursaut/core";
import { setPlatform } from "@sursaut/kit";
import { vi } from "vitest";
import { createTestAdapter } from "../../../ownk/sursaut/packages/kit/src/platform/test";

setPlatform(createTestAdapter());

// Plain-object module mocks do not trigger mutts `touched`; Sursaut would false-positive `checkReactivity` warnings on bidi props.
sursautOptions.checkReactivity = false;

// Setup global test functions for vitest
// @ts-expect-error - Adding global test functions
globalThis.describe = vi.describe;
// @ts-expect-error - Adding global test functions
globalThis.it = vi.it;
// @ts-expect-error - Adding global test functions
globalThis.expect = vi.expect;
// @ts-expect-error - Adding global test functions
globalThis.beforeEach = vi.beforeEach;
// @ts-expect-error - Adding global test functions
globalThis.afterEach = vi.afterEach;
// @ts-expect-error - Adding global test functions
globalThis.beforeAll = vi.beforeAll;
// @ts-expect-error - Adding global test functions
globalThis.afterAll = vi.afterAll;
