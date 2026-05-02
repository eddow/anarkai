import { unreactive } from 'mutts'
import { traces } from '../dev/debug.ts'

/**
 * A commitment is something that has been promised and must eventually be resolved.
 *
 * Every commitment starts in `not begun` (`ended === undefined`), transitions to
 * `begun` (`ended === false`) when started, and must end in either `fulfilled`
 * (`ended === true`) or `cancelled` (`ended === string`).
 *
 * Forgetting to resolve a commitment is a leak — the GC guard detects this and raises an error.
 *
 * This is the root type for:
 * - Steps (timed activities that tick each frame)
 * - Storage allocations (goods reserved or room promised)
 * - Plans (NPC work intent backed by allocations)
 * - Convey hops (goods in flight between borders)
 *
 * ## Naming
 *
 * "Commitment" because the object represents a pledge that must be honoured or explicitly released.
 * Not "promise" (too close to JS `Promise`), not "token" (too generic), not "allocation" (too narrow).
 *
 * ## Lifecycle
 *
 * ```
 * not begun (undefined) → begun (false) → fulfilled (true)
 *                                       → cancelled (string)
 * ```
 *
 * ## GC guard
 *
 * If a `Commitment` is garbage-collected while still `not begun` or `begun`, the finalization registry
 * logs an error with the creation stack and label — this catches leaked commitments that
 * were never resolved.
 */
@unreactive
export class Commitment {
	#ended: CommitmentEnding
	get ended(): CommitmentEnding {
		return this.#ended
	}
	#onStarted: (() => void)[] = []
	#onFulfilled: (() => void)[] = []
	#onCancelled: (() => void)[] = []
	#onFinal: (() => void)[] = []

	constructor(readonly label: string) {
		commitmentRegistry.register(
			this,
			{
				label,
				stack: new Error().stack ?? '',
			},
			this
		)
	}

	/** Register a callback for when this commitment is started (begin() called). Returns `this` for chaining. */
	onStarted(callback: () => void): this {
		this.#onStarted.push(callback)
		return this
	}

	/** Register a callback for when this commitment is fulfilled. Returns `this` for chaining. */
	onFulfilled(callback: () => void): this {
		this.#onFulfilled.push(callback)
		return this
	}

	/** Register a callback for when this commitment is cancelled. Returns `this` for chaining. */
	onCancelled(callback: () => void): this {
		this.#onCancelled.push(callback)
		return this
	}

	/** Register a callback for when this commitment is resolved (either way). Returns `this` for chaining. */
	onFinal(callback: () => void): this {
		this.#onFinal.push(callback)
		return this
	}

	/** Compatibility alias for older step tests/call sites. */
	final(callback: () => void): this {
		return this.onFinal(callback)
	}

	/**
	 * Mark this commitment as begun. No-op if already begun or resolved.
	 * After calling `begin()`, `ended` transitions from `undefined` to `false`.
	 * Fires `onStarted` callbacks on first transition.
	 */
	begin(): void {
		if (this.#ended !== undefined) return
		this.#ended = false
		for (const callback of this.#onStarted) {
			try {
				callback()
			} catch (error) {
				traces.commitments?.error?.(
					`[Commitment] Error in started callback for "${this.label}":`,
					error
				)
			}
		}
		this.#onStarted = []
	}

	/**
	 * Resolve this commitment as successfully completed.
	 * No-op if already resolved. Must be begun first (call `begin()`).
	 */
	fulfill(): void {
		if (this.#ended === true || typeof this.#ended === 'string') return
		if (this.#ended === undefined) {
			this.begin()
		}
		this.#ended = true
		this.#resolve(this.#onFulfilled)
	}

	/** Compatibility alias for older step tests/call sites. */
	finish(): void {
		this.fulfill()
	}

	/**
	 * Resolve this commitment as cancelled / rolled back.
	 * No-op if already resolved. Must be begun first (call `begin()`).
	 */
	cancel(reason: string): void {
		if (this.#ended === true || typeof this.#ended === 'string') return
		if (this.#ended === undefined) {
			this.begin()
		}
		this.#ended = reason
		this.#resolve(this.#onCancelled)
	}

	#resolve(phase: (() => void)[]): void {
		commitmentRegistry.unregister(this)
		for (const callback of [...phase, ...this.#onFinal]) {
			try {
				callback()
			} catch (error) {
				traces.commitments?.error?.(
					`[Commitment] Error in resolution callback for "${this.label}":`,
					error
				)
			}
		}
		this.#onFulfilled = []
		this.#onCancelled = []
		this.#onFinal = []
	}
	serialize(): SerializedCommitment {
		return {
			label: this.label,
		}
	}
}

export type CommitmentEnding =
	| true // success
	| false // begun but not yet resolved
	| string // failure reason (debug purposes)
	| undefined // not yet begun

/**
 * `undefined` = success, `string` = failure reason (for debug/tracing).
 * Used as the return type for `allocate`/`reserve` after Phase 3 migration.
 *
 * IMPORTANT: `''` (empty string) is NOT a valid success signal.
 * The check is `reason !== undefined`, so any string — including `''` —
 * is treated as a failure. Callers must return `undefined` for success.
 */
export type FailureReason = string | undefined

/**
 * Assert that an allocation succeeded. If `reason` is a string, log it
 * via `traces.commitments.assert` and throw.
 *
 * Used by every `allocate`/`reserve` call site — high enough severity
 * because these are called from constructors and "must succeed" paths.
 */
export function assertSuccess(reason: FailureReason, label: string): void {
	if (reason !== undefined) {
		traces.commitments?.assert?.(false, `[${label}] ${reason}`)
		throw new Error(`Allocation failed: ${label}: ${reason}`)
	}
}

interface GCLeakInfo {
	label: string
	stack: string
}

/**
 * Module-level finalization registry.
 * Lives outside the class body because `@unreactive` (class decorator) conflicts
 * with static private fields in TypeScript's emit pipeline.
 */
const commitmentRegistry =
	typeof FinalizationRegistry !== 'undefined'
		? new FinalizationRegistry<GCLeakInfo>((info) => {
				console.error(
					`Leaked Commitment (GC'd without resolve): "${info.label}"`,
					info.stack ? `\n  stack:\n${info.stack}` : ''
				)
				traces.commitments?.error?.("Leaked Commitment (GC'd without resolve):", info)
			})
		: ({
				register: () => {},
				unregister: () => {},
			} as unknown as FinalizationRegistry<GCLeakInfo>)

/**
 * Serialization shape for commitments that need save/load.
 * Subclasses extend this with their own fields.
 */
export interface SerializedCommitment {
	readonly label: string
	//We only serialize ongoing commitments, so we don't need to serialize the ending
	//readonly ended: CommitmentEnding
}
