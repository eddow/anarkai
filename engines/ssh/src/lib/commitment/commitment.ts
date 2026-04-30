import { unreactive } from 'mutts'
import { traces } from '../dev/debug.ts'

/**
 * A commitment is something that has been promised and must eventually be resolved.
 *
 * Every commitment starts in `pending` and must end in either `fulfilled` or `cancelled`.
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
 * pending → fulfilled
 *         → cancelled
 * ```
 *
 * ## GC guard
 *
 * If a `Commitment` is garbage-collected while still `pending`, the finalization registry
 * logs an error with the creation stack and label — this catches leaked commitments that
 * were never resolved.
 */
@unreactive
export class Commitment {
	#ended: CommitmentEnding
	get ended(): CommitmentEnding {
		return this.#ended
	}
	#onFulfilled: (() => void)[] = []
	#onCancelled: (() => void)[] = []
	#onFinal: (() => void)[] = []

	constructor(readonly label: string) {
		commitmentRegistry.register(this, {
			label,
			stack: new Error().stack ?? '',
		})
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

	/** Resolve this commitment as successfully completed. No-op if already resolved. */
	fulfill(): void {
		if (this.ended !== undefined) return
		this.#ended = true
		this.#resolve(this.#onFulfilled)
	}

	/** Resolve this commitment as cancelled / rolled back. No-op if already resolved. */
	cancel(reason: string): void {
		if (this.ended !== undefined) return
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
	| string // failure reason (debug purposes)
	| undefined // pending

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
