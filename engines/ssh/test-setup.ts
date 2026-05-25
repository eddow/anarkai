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
import {
	disconnectAllProfiles,
	disconnectAllTraces,
	setProfileLevel,
	setTraceDiagnosticReporter,
	setTraceLevel,
	type TraceVerb,
} from "./src/lib/dev/debug.ts";
import type { ProfileLevel } from "./src/lib/dev/profile.ts";
import { options } from "ssh/globals";
import { resetDebugActiveAllocations } from "ssh/storage/guard";

type TestDiagnosticEntry = {
	level: "warn" | "assert" | "error";
	text: string;
};

const originalConsoleWarn = console.warn.bind(console);
const originalConsoleError = console.error.bind(console);
const defaultDisallowedDiagnostics = [
	/^\[trace:[^:\]]+:assert failure\]/,
	/^\[trace:[^:\]]+:error\]/,
	/\[vehicle\.advertisedJobs\] dock work exists but bay has no convey job/,
	/\[vehicle\.advertisedJobs\] loaded docked vehicle has no advertised job/,
	/vehicleOffload pickup: stale loose good/,
	/character\.position\.set\.recoverFootPositionWithoutVehicle/,
	/High loop count in nextStep/,
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
const requestedTraceChannels = (process.env.SSH_TRACE_CHANNELS ?? "")
	.split(",")
	.map((channel) => channel.trim())
	.filter(Boolean);
const requestedTraceLevel = process.env.SSH_TRACE_LEVEL ?? "log";
const traceVerbs: readonly TraceVerb[] = ["log", "warn", "assert", "error"];
const requestedProfileChannels = (process.env.SSH_PROFILE_CHANNELS ?? "")
	.split(",")
	.map((channel) => channel.trim())
	.filter(Boolean);
const requestedProfileLevel = process.env.SSH_PROFILE_LEVEL ?? "summary";
const profileLevels: readonly ProfileLevel[] = ["summary", "detail", "stack"];

const applyRequestedTraceLevels = () => {
	if (!traceVerbs.includes(requestedTraceLevel as TraceVerb)) {
		throw new Error(
			`Invalid SSH_TRACE_LEVEL "${requestedTraceLevel}". Expected one of: ${traceVerbs.join(", ")}`,
		);
	}
	for (const channel of requestedTraceChannels) {
		setTraceLevel(channel, requestedTraceLevel as TraceVerb);
	}
};

applyRequestedTraceLevels();

const applyRequestedProfileLevels = () => {
	if (!profileLevels.includes(requestedProfileLevel as ProfileLevel)) {
		throw new Error(
			`Invalid SSH_PROFILE_LEVEL "${requestedProfileLevel}". Expected one of: ${profileLevels.join(", ")}`,
		);
	}
	for (const channel of requestedProfileChannels) {
		setProfileLevel(channel, requestedProfileLevel as ProfileLevel);
	}
};

applyRequestedProfileLevels();

const formatDiagnosticArg = (arg: unknown): string => {
	if (typeof arg === "string") return arg;
	return inspect(arg, { depth: 4, breakLength: Infinity });
};

const recordDiagnostic = (level: TestDiagnosticEntry["level"], args: unknown[]) => {
	capturedDiagnostics.push({
		level,
		text: args.map(formatDiagnosticArg).join(" "),
	});
};

setTraceDiagnosticReporter(({ channel, level, text }) => {
	recordDiagnostic(level === "assert failure" ? "assert" : level, [
		`[trace:${channel}:${level}] ${text}`,
	]);
});

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

		// Bounded inspect — JSON.stringify on large reactive graphs can stall tests for minutes.
		const brief = (val: unknown) =>
			inspect(val, { depth: 3, maxArrayLength: 24, breakLength: 120, compact: true });

		const cachedJson = brief(cached);
		const freshJson = brief(fresh);
		if (cachedJson === freshJson) return;

		const methodName = fn?.name || fn?.key || "unknown";
		const className = fn?.owner?.name || fn?.owner?.constructor?.name || "";
		const message = `Memoization discrepancy in ${className ? `${className}.` : ""}${methodName}`;
		console.error("\x1b[31m" + message + "\x1b[0m");

		console.error("Cached:", cachedJson);
		console.error("Fresh:", freshJson);
		console.error("Cause:", cause);
		const owner = args?.[0];
		if (owner) {
			console.error(
				"Owner:",
				owner?.constructor?.name ?? typeof owner,
				brief(owner),
			);
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
	disconnectAllProfiles();
	applyRequestedTraceLevels();
	applyRequestedProfileLevels();
	resetDebugActiveAllocations();
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
	disconnectAllProfiles();
	resetDebugActiveAllocations();
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
