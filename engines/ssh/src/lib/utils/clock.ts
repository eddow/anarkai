/**
 * Clock — pure-delta simulation event scheduler.
 *
 * Every value is a `ds` (delta-second, virtual). No absolute time.
 * A sorted list of `Clocked` steps, each storing a relative delay from
 * the previous entry.
 *
 *   advance(ds)      — advance simulation by ds, progress & complete steps
 *   begin(step, ds?) — schedule a timed step (ds) or an off-clock step (no ds)
 *
 * Serialization: each step stores its own `remainingDs`. The clock list
 * is rebuilt on load from step state. No need to serialize the clock itself.
 */

// ─── Clocked ───────────────────────────────────────────────────────────────

import type { Game } from 'ssh/game/game'

/**
 * A step that participates in the simulation clock.
 *
 * Timed steps (remainingDs > 0): the clock drives both progress() and complete().
 * Off-clock steps (remainingDs = 0): externally completed (QueueStep, WaitForPredicateStep).
 * The clock stores them so `begin(newStep, ds)` can cancel/replace them.
 */
export interface Clocked {
	/** The owning game. Provides access to `game.clock` for scheduling next steps. */
	readonly game: Game

	/**
	 * Delta-seconds until completion.
	 * Should be computed by the clock on serialization time.
	 */
	readonly remainingDs: number

	/**
	 * Called each time this step receives simulation time during advance().
	 * Advances visual state: lerp position, transform buffer, hunger, etc.
	 *
	 * Only called for timed steps (remainingDs > 0).
	 */
	progress(ds: number): void

	/**
	 * Called when this step's remainingDs expires (clock-driven)
	 * OR when an external trigger fires (off-clock).
	 *
	 * Writes definitive state. Returns new remainingDs to reschedule
	 * on the clock, or `undefined` → step is done, removed from clock.
	 */
	complete(): undefined
}

// ─── ClockEntry (internal) ─────────────────────────────────────────────────

interface ClockEntry {
	/**
	 * Delta-seconds from the previous entry's expiry (or from now, for head).
	 * Gets consumed by advance(). Off-clock entries have relDs = Infinity
	 * (never expire — removed only by external complete).
	 */
	relDs: number
	/** The step. */
	step: Clocked
}

// ─── Clock ─────────────────────────────────────────────────────────────────

export class Clock {
	/**
	 * Cumulative virtual time in seconds. Updated by each {@link advance} call.
	 * The renderer reads this for UI clock display.
	 */
	public virtualTime = 0

	/**
	 * Sorted list. Entry N expires at
	 * `entries[0].relDs + entries[1].relDs + … + entries[N].relDs`
	 * delta-seconds from now.
	 *
	 * Off-clock entries are stored at the end with relDs = Infinity.
	 */
	private list: ClockEntry[] = []
	private partiallyProgressed?: {
		freshEntries: WeakMap<Clocked, number>
		partialDs: number
	}
	private serializationTimes?: WeakMap<Clocked, number>

	// ── Public API ──────────────────────────────────────────────────────────

	/**
	 * Advance simulation by `ds` delta-seconds.
	 *
	 * For each timed entry whose span is reached: calls progress() on entries
	 * that receive time, then complete() on entries whose relDs expires.
	 * Off-clock entries are skipped.
	 */
	advance(ds: number): void {
		this.serializationTimes = undefined
		this.virtualTime += ds
		if (ds <= 0 || this.list.length === 0) return

		let remaining = ds
		this.partiallyProgressed = { freshEntries: new WeakMap(), partialDs: 0 }

		while (this.list.length > 0) {
			const head = this.list[0]!

			if (!Number.isFinite(head.relDs)) break

			if (head.relDs > remaining + 1e-9) {
				if (remaining <= 0) break // nothing left to advance
				// Head spans further than remaining ds: partial progress
				head.relDs -= remaining
				remaining = 0
			} else {
				const stepDs = head.relDs
				this.partiallyProgressed!.partialDs += stepDs
				remaining -= stepDs
				this.list.shift()
				head.step.complete()
			}
		}
		// If the `clocked` was freshly added during this advance, it shouldn't receive progress for the whole current advance, only the advance after its insertion
		// All surviving entries (timed + off-clock) receive progress.
		// Off-clock entries (QueueStep, WaitForPredicateStep) still need
		// animation even though their completion is externally managed.
		for (const entry of this.list)
			entry.step.progress(ds - (this.partiallyProgressed!.freshEntries.get(entry.step) ?? 0))
		this.partiallyProgressed = undefined
	}

	/**
	 * Schedule a step on the clock.
	 *
	 *   begin(step)       — off-clock: stored but never progressed/completed
	 *                        by the clock. External code must call complete().
	 *   begin(step, ds)   — timed: clock calls progress() each advance and
	 *                        complete() when ds expires.
	 */
	begin(step: Clocked): void
	begin(step: Clocked, ds: number): void
	begin(step: Clocked, ds?: number): void {
		this.serializationTimes = undefined
		this.remove(step)

		if (ds === undefined) {
			// Off-clock: never auto-completed
			this.list.push({ relDs: Number.POSITIVE_INFINITY, step })
		} else {
			// Timed: always insert — even ds ≤ 0 goes through the normal
			// advance() flow. Never call complete() synchronously.
			const effDs = Math.max(0, ds)
			if (this.partiallyProgressed)
				this.partiallyProgressed.freshEntries.set(step, this.partiallyProgressed.partialDs)
			this.insert(effDs, step)
		}
	}

	/**
	 * Remove a step from the clock. Idempotent.
	 */
	remove(step: Clocked): void {
		this.serializationTimes = undefined
		const idx = this.list.findIndex((e) => e.step === step)
		if (idx === -1) return

		const removed = this.list[idx]!
		this.list.splice(idx, 1)

		// Pass the removed entry's finite gap to the next entry
		if (Number.isFinite(removed.relDs) && idx < this.list.length)
			this.list[idx]!.relDs += removed.relDs
	}

	// ── Internals ───────────────────────────────────────────────────────────

	/**
	 * Insert a step so it completes `effDs` delta-seconds from now.
	 * Walks the list accumulating relDs, splits the gap at the target.
	 */
	private insert(effDs: number, step: Clocked): void {
		if (this.partiallyProgressed)
			this.partiallyProgressed.freshEntries.set(step, this.partiallyProgressed.partialDs)
		for (let i = 0; i < this.list.length; i++) {
			const entry = this.list[i]!

			// Stop at off-clock entries — timed entries are always before them
			if (!Number.isFinite(entry.relDs)) break

			if (entry.relDs > effDs + 1e-9) {
				const beforeNew = effDs
				const afterNew = entry.relDs - beforeNew
				entry.relDs = afterNew
				this.list.splice(i, 0, { relDs: beforeNew, step })
				return
			}

			effDs -= entry.relDs
		}

		// Append before off-clock entries
		const insertIdx = this.list.findIndex((e) => !Number.isFinite(e.relDs))
		if (insertIdx === -1) {
			this.list.push({ relDs: effDs, step })
		} else {
			this.list.splice(insertIdx, 0, { relDs: effDs, step })
		}
	}

	/** Number of steps currently on the clock. */
	get size(): number {
		return this.list.length
	}

	// ── Debug ───────────────────────────────────────────────────────────────

	dump(): Array<{ relDs: number; effDs: number }> {
		let acc = 0
		return this.list
			.filter((e) => Number.isFinite(e.relDs))
			.map((e) => {
				acc += e.relDs
				return { relDs: e.relDs, effDs: acc }
			})
	}
	serializeTime(step: Clocked): number | undefined {
		if (!this.serializationTimes) {
			this.serializationTimes = new WeakMap()
			let acc = 0
			for (const entry of this.list) {
				if (!Number.isFinite(entry.relDs)) break
				acc += entry.relDs
				this.serializationTimes.set(entry.step, acc)
			}
		}
		return this.serializationTimes.get(step)
	}
}
