import { reactive, unwrap } from 'mutts'

/**
 * Runtime registry of "watched" objects for entity-focused tracing.
 *
 * A watched object opts in to `debug`-level tracing: when a channel is at the
 * `debug` verb, it acts as `warn` in general but as `log` for watched subjects
 * (see `traceFor` in `debug.ts`).
 *
 * Identity is keyed by the raw (unproxied) target so a Mutts reactive proxy and
 * its underlying target resolve to the same entry — no debug id string needed.
 */
let watchedSubjects = new WeakSet<object>()

/** Monotonic counter bumped on every watch/unwatch/reset so UI can track watch state reactively. */
const watchVersionState = reactive({ version: 0 })

/** Number of currently-watched subjects (a `WeakSet` has no `size`). */
let watchedCount = 0

/** Listeners fired when the watched set transitions (size 0→1 or 1→0). */
const watchChangeListeners = new Set<() => void>()

/** Current watch-filter version. Read inside a reactive effect to re-run when the set changes. */
export function watchVersion(): number {
	return watchVersionState.version
}

/** Number of currently-watched subjects. Used by `debug.ts` to arm trace channels while ≥1 subject is watched. */
export function watchCount(): number {
	return watchedCount
}

/**
 * Subscribe to watch-filter membership changes. Returns an unsubscribe function.
 * `debug.ts` uses this to raise trace channels to `debug` while any subject is
 * watched (so watched entities log at full detail), and restore them on release.
 */
export function onWatchChange(listener: () => void): () => void {
	watchChangeListeners.add(listener)
	return () => {
		watchChangeListeners.delete(listener)
	}
}

function notifyWatchChange(): void {
	watchVersionState.version++
	for (const listener of watchChangeListeners) listener()
}

/** Mark `subject` as watched. Idempotent; accepts a proxy or its raw target. */
export function watch(subject: object): void {
	const raw = unwrap(subject) as unknown as object
	if (!raw || watchedSubjects.has(raw)) return
	watchedSubjects.add(raw)
	watchedCount++
	notifyWatchChange()
}

/** Stop watching `subject`. */
export function unwatch(subject: object): void {
	const raw = unwrap(subject) as unknown as object
	if (!raw) return
	const removed = watchedSubjects.delete(raw)
	if (!removed) return
	watchedCount--
	notifyWatchChange()
}

/** True when `subject` is in the watched set (identity-based, proxy-aware). */
export function isWatched(subject: unknown): boolean {
	if (!subject || (typeof subject !== 'object' && typeof subject !== 'function')) return false
	const raw = unwrap(subject as object) as unknown
	if (!raw || (typeof raw !== 'object' && typeof raw !== 'function')) return false
	return watchedSubjects.has(raw as object)
}

/** Clear all watched subjects. Used by test setup so tests start with a clean filter. */
export function resetWatched(): void {
	watchedSubjects = new WeakSet()
	watchedCount = 0
	notifyWatchChange()
}
