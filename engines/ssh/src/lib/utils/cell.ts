/**
 * Anything with a monotonic change stamp, so a {@link Derived} can compare versions to decide
 * lazily whether to recompute.
 */
export interface Versioned {
	versionOf(): number
}

/**
 * A versioned, non-reactive value cell — the kernel's source-of-truth primitive.
 *
 * `Cell` is the ad-hoc replacement for mutts `reactive()` on **kernel** state: reads must not pay
 * proxy/read-tracking overhead (they run plain, under `@inert`), and the whole thing must port 1:1
 * to Rust.
 *
 * - `get()` is a plain field read — it never registers a listener or a dependency.
 * - `set()` is the *only* write path; it advances an internal version when the value changes.
 * - `versionOf()` exposes the monotonic change stamp consumed by {@link Derived}.
 *
 * The UI observes a `Cell` only through a reactive mirror written at the boundary — mutts never
 * tracks a `Cell` directly.
 */
export class Cell<T> implements Versioned {
	private value: T
	private version = 0

	constructor(value: T) {
		this.value = value
	}

	/** Plain read — inert-safe, no dependency registration. */
	get(): T {
		return this.value
	}

	/** The only write path; bumps the version when the value actually changes. */
	set(next: T): void {
		if (Object.is(next, this.value)) return
		this.value = next
		this.version++
	}

	/** Monotonic change stamp, consumed by {@link Derived} for lazy invalidation. */
	versionOf(): number {
		return this.version
	}
}

/**
 * A lazily-recomputed value over a *statically-declared* set of deps.
 *
 * Unlike mutts `memoize` (implicit read-time dependency tracking), deps are declared at
 * construction. `get()` compares the deps' current versions against the versions recorded at the
 * last compute and recomputes only when one advanced. Reads are plain, so this is inert-safe and
 * ports 1:1 to Rust — there is no listener, no proxy, no effect scheduler.
 *
 * Dependencies may be {@link Cell}s or other {@link Derived}s (both are {@link Versioned}); a
 * `Derived` bumps its own version only when its recomputed value actually changes, so a chain of
 * derived values does not cascade unnecessarily.
 */
export class Derived<T> implements Versioned {
	private cached!: T
	private has = false
	private lastDepsSum = 0
	private version = 0

	constructor(
		private readonly compute: () => T,
		private readonly deps: readonly Versioned[]
	) {}

	/** Lazy read — recomputes only when a declared dep advanced since the last compute. */
	get(): T {
		const current = this.depsSum()
		if (!this.has || current !== this.lastDepsSum) {
			const next = this.compute()
			if (!this.has || !Object.is(next, this.cached)) {
				this.cached = next
				this.version++
			}
			this.lastDepsSum = current
			this.has = true
		}
		return this.cached
	}

	versionOf(): number {
		return this.version
	}

	/**
	 * Sum of the deps' versions. Because every `versionOf()` is monotonic (never decreases), the sum
	 * changes **iff at least one dep advanced** — a single scalar that exactly detects "any change".
	 * (`max` would be wrong: a non-max dep advancing would leave the max — and thus the comparison —
	 * unchanged.)
	 */
	private depsSum(): number {
		let sum = 0
		for (const dep of this.deps) {
			sum += dep.versionOf()
		}
		return sum
	}
}

/**
 * A bump-only change signal — a `Cell` that carries no value, only a monotonic version.
 *
 * This is the kernel's "revision" for *collection* or *graph* state that is mutated in place (a
 * `Map` / `AxialKeyMap` / array you would never re-`set` wholesale). The mutator calls
 * {@link Version.bump} in the same method that changes the collection; {@link Derived} values
 * declare the `Version` as a dependency and compare `versionOf()` on read, so a derived value
 * recomputes lazily and can never go stale. Because the version lives with the state it guards and
 * is compared on read, there is no "forgotten invalidation" failure mode — unlike a `clear()`-at-
 * mutator cache whose invalidation the author must remember to call.
 */
export class Version implements Versioned {
	private version = 0

	/** Advance the version — call in the same method that mutates the guarded collection. */
	bump(): void {
		this.version++
	}

	versionOf(): number {
		return this.version
	}
}

/**
 * A keyed cache using the **generation pattern**: a fresh `Map` per {@link Version}, so entries are
 * discarded wholesale when the version bumps and recompute lazily per key.
 *
 * The caller keys the per-owner {@link Derived} by owner identity (e.g. a `Game`) so entries don't
 * leak across owners, and passes the owner's `Version` on each call (owner ↔ version is a stable
 * 1:1, so the `Derived` binds the right cell at first use).
 *
 * This is the ad-hoc replacement for the old `KeyedRevisionedCache` keyed on a global revision
 * counter: same lazy per-key semantics, but invalidation is a version bump compared on read — no
 * global counter, and no `clear()` the mutator could forget.
 */
export class GenerationCache<T> {
	private readonly derivedByOwner = new WeakMap<object, Derived<Map<string, T>>>()

	private map(owner: object, version: Version): Map<string, T> {
		let derived = this.derivedByOwner.get(owner)
		if (!derived) {
			derived = new Derived(() => new Map<string, T>(), [version])
			this.derivedByOwner.set(owner, derived)
		}
		return derived.get()
	}

	/** Return the cached value, or compute (and store) it on a miss. Distinguishes a cached `undefined`. */
	getOrCompute(owner: object, version: Version, key: string, compute: () => T): T {
		const map = this.map(owner, version)
		if (map.has(key)) return map.get(key)!
		const value = compute()
		map.set(key, value)
		return value
	}
}
