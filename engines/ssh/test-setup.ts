// Basic test setup for ssh project
// This file is required by vitest.config.ts

// Register rules/content mocks before any test file import can pull `engine-rules`
// transitively (e.g. `ssh/utils/axial` → `engine-terrain`), which would otherwise
// cache the real module before `vi.mock` runs.
import "./tests/test-engine/mocks";

import { inspect } from "node:util";
import { afterEach, beforeEach, vi } from "vitest";

// Clear mutts instance if it exists
delete (global as any).__MUTTS_INSTANCE__;

import { getActivationLog, reactiveOptions, reset, unreactive } from "mutts";
import { disconnectAllTraces } from "ssh/debug";
import { options } from "ssh/globals";

type TestDiagnosticEntry = {
	level: "warn" | "error";
	text: string;
};

const originalConsoleWarn = console.warn.bind(console);
const originalConsoleError = console.error.bind(console);
const defaultDisallowedDiagnostics = [
	/\[WATCHDOG\]/,
	/\[aGoodMovement\]/,
	/\[conveyStep\]/,
	/\[INCOMING\]/,
	/Invalid movement token/,
	/Broken movement/,
	/Detached movement allocation/,
	/Offloaded broken border movement/,
	/Movement became invalid/,
];
let capturedDiagnostics: TestDiagnosticEntry[] = [];
let allowedDiagnosticPatterns: RegExp[] = [];
const defaultStalledMovementScanIntervalMs = options.stalledMovementScanIntervalMs;

const formatDiagnosticArg = (arg: unknown): string => {
	if (typeof arg === "string") return arg;
	return inspect(arg, { depth: 4, breakLength: Infinity });
};

const recordDiagnostic = (level: "warn" | "error", args: unknown[]) => {
	capturedDiagnostics.push({
		level,
		text: args.map(formatDiagnosticArg).join(" "),
	});
};

console.warn = (...args: Parameters<typeof console.warn>) => {
	recordDiagnostic("warn", args);
	return originalConsoleWarn(...args);
};

console.error = (...args: Parameters<typeof console.error>) => {
	recordDiagnostic("error", args);
	return originalConsoleError(...args);
};

const allowExpectedDiagnostics = (...patterns: (string | RegExp)[]) => {
	for (const pattern of patterns) {
		allowedDiagnosticPatterns.push(
			typeof pattern === "string" ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : pattern,
		);
	}
};

// @ts-expect-error - test helper injected globally
globalThis.allowExpectedDiagnostics = allowExpectedDiagnostics;

// Ensure memoization discrepancies throw error in tests
let inDiscrepancy = false;
reactiveOptions.onMemoizationDiscrepancy = (
	cached,
	fresh,
	fn: any,
	args,
	cause,
) => {
	if (inDiscrepancy) return;
	inDiscrepancy = true;
	try {
		// Fast pass: same target object
		if (unreactive(cached) === unreactive(fresh)) return;

		// Second pass: deep equality via safe JSON
		const safeStringify = (val: any, indent?: number) => {
			const seen = new WeakSet();
			try {
				return JSON.stringify(
					val,
					(key, value) => {
						if (typeof value === "object" && value !== null) {
							if (seen.has(value)) return "[Circular]";
							seen.add(value);
						}
						return value;
					},
					indent,
				);
			} catch {
				return `[Unserializable: ${val?.constructor?.name || typeof val}]`;
			}
		};

		const cachedJson = safeStringify(cached);
		const freshJson = safeStringify(fresh);
		if (cachedJson === freshJson) return;

		const methodName = fn?.name || fn?.key || "unknown";
		const className = fn?.owner?.name || fn?.owner?.constructor?.name || "";
		const message = `Memoization discrepancy in ${className ? `${className}.` : ""}${methodName}`;
		console.error("\x1b[31m" + message + "\x1b[0m");

		console.error("Cached:", safeStringify(cached, 2));
		console.error("Fresh:", safeStringify(fresh, 2));
		console.error("Cause:", cause);
		const owner = args?.[0];
		if (owner) {
			console.error("Owner state:", safeStringify(owner, 2));
		}
		throw new Error(message);
	} finally {
		inDiscrepancy = false;
	}
};

let activationLogDumped = false;
const dumpActivationLog = (error: unknown) => {
	if (
		activationLogDumped ||
		!(error instanceof Error) ||
		(!error.message.includes("Max effect chain reached") &&
			!error.message.includes("Reactive system is broken"))
	) {
		return;
	}
	activationLogDumped = true;
	const entries = getActivationLog().filter(Boolean).slice(0, 25);
	console.error("Recent reactive activations:");
	for (const entry of entries) {
		const effectName = entry.effect?.name || "anonymous";
		const objectName = entry.obj?.constructor?.name || typeof entry.obj;
		console.error(`${effectName} :: ${objectName}.${String(entry.prop)}`);
	}
};
const processListenerKey = "__SSH_TEST_SETUP_PROCESS_LISTENERS__";
if (!(globalThis as any)[processListenerKey]) {
	(globalThis as any)[processListenerKey] = true;
	process.on("uncaughtException", (error) => {
		dumpActivationLog(error);
		throw error;
	});
	process.on("unhandledRejection", (reason) => {
		dumpActivationLog(reason);
		throw reason;
	});
}

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

beforeEach(() => {
	activationLogDumped = false;
	capturedDiagnostics = [];
	allowedDiagnosticPatterns = [];
	options.stalledMovementScanIntervalMs = 0;
	disconnectAllTraces();
	reset();
});

afterEach(async () => {
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setTimeout(resolve, 0));
	const unexpectedDiagnostics = capturedDiagnostics.filter(({ text }) => {
		const isDisallowed = defaultDisallowedDiagnostics.some((pattern) => pattern.test(text));
		if (!isDisallowed) return false;
		return !allowedDiagnosticPatterns.some((pattern) => pattern.test(text));
	});
	capturedDiagnostics = [];
	allowedDiagnosticPatterns = [];
	activationLogDumped = false;
	options.stalledMovementScanIntervalMs = defaultStalledMovementScanIntervalMs;
	disconnectAllTraces();
	reset();
	if (unexpectedDiagnostics.length > 0) {
		const lines = unexpectedDiagnostics
			.slice(0, 5)
			.map(({ level, text }) => `[${level}] ${text}`)
			.join("\n\n");
		throw new Error(
			`Unexpected convey/watchdog diagnostics were emitted during the test:\n\n${lines}`,
		);
	}
});

// Mock browser environment for PixiJS
if (typeof Node === "undefined") {
	(global as any).Node = class {};
}
if (typeof Element === "undefined") {
	(global as any).Element = class {};
}
if (typeof HTMLElement === "undefined") {
	(global as any).HTMLElement = class {};
}
if (typeof SVGElement === "undefined") {
	(global as any).SVGElement = class {};
}
if (typeof HTMLCollection === "undefined") {
	(global as any).HTMLCollection = class {};
}
if (typeof EventTarget === "undefined") {
	(global as any).EventTarget = class {};
}
if (typeof NodeList === "undefined") {
	(global as any).NodeList = class {};
}
if (typeof CustomEvent === "undefined") {
	(global as any).CustomEvent = class {};
}
if (typeof document === "undefined") {
	(global as any).document = {
		createElement: () => ({
			getContext: () => ({
				fillRect: () => {},
				drawImage: () => {},
				getImageData: () => ({ data: [] }),
				measureText: () => ({ width: 0 }),
				getParameter: () => 0,
				getExtension: () => ({}),
			}),
			canPlayType: () => "",
			width: 100,
			height: 100,
			addEventListener: () => {},
		}),
		body: { appendChild: () => {}, removeChild: () => {} },
	};
	(global as any).document.baseURI = "http://localhost/";
}
if (typeof window === "undefined") {
	(global as any).window = {
		addEventListener: () => {},
		removeEventListener: () => {},
		navigator: { userAgent: "node" },
		requestAnimationFrame: (cb: any) => setTimeout(cb, 16),
		document: (global as any).document,
	};
	// Bind window to global if needed by some libs, but usually window.X access works if window is defined
}
if (typeof navigator === "undefined") {
	(global as any).navigator = { userAgent: "node" };
}
if (typeof requestAnimationFrame === "undefined") {
	(global as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 16);
}
if (typeof Image === "undefined") {
	(global as any).Image = class {
		_src = "";
		onload: any;
		onerror: any;
		set src(val: string) {
			this._src = val;
			setTimeout(() => this.onload && this.onload(), 1);
		}
		get src() {
			return this._src;
		}
	};
}
if (typeof fetch === "undefined" || true) {
	(global as any).fetch = () =>
		Promise.resolve({
			ok: true,
			status: 200, // Added status for robustness
			json: () => Promise.resolve({}),
			blob: () => Promise.resolve(new Blob()),
			text: () => Promise.resolve(""),
		});
}
if (typeof localStorage === "undefined") {
	(global as any).localStorage = {
		getItem: () => null,
		setItem: () => {},
		removeItem: () => {},
		clear: () => {},
	};
}
