// Pre-setup: runs before test-setup.ts and before any @sursaut/* imports.
// sursaut's hookRootedEventListeners() patches EventTarget.prototype.addEventListener,
// but calls the original via .call(this, ...) which breaks jsdom 27.4.0's webidl slot check.
// Temporarily hide EventTarget so hookRootedEventListeners() returns undefined,
// causing sursaut to fall back to target.addEventListener (no .call() needed).
if (typeof globalThis !== 'undefined') {
	;(globalThis as any).__sursautEventTarget = (globalThis as any).EventTarget
	;(globalThis as any).EventTarget = undefined
}
}
