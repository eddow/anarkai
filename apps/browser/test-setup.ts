// Basic test setup for ssh project
// This file is required by vitest.config.ts

import { sursautOptions } from "@sursaut/core";
import { mountHeadContent, setPlatform } from "@sursaut/kit";
import { reactive } from "mutts";
import { vi } from "vitest";

const url = new URL("http://localhost/");

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
		history: { length: 1, navigation: "load" },
		focused: false,
		visibilityState: "hidden",
		devicePixelRatio: 1,
		online: true,
		language: "en-US",
		timezone: "UTC",
		direction: "ltr",
		prefersDark: false,
		navigate() {
			throw new Error("client.navigate() is not available in test context");
		},
		replace() {
			throw new Error("client.replace() is not available in test context");
		},
		reload() {
			throw new Error("client.reload() is not available in test context");
		},
		dispose() {},
	}),
	mountHead: (content, env) => mountHeadContent(document.head, content, env),
});

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
