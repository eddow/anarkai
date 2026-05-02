import { Commitment } from '../../commitment/commitment'

/**
 * A `PlanCommitment` wraps the allocation lifecycle for a plan (TransferPlan or PickupPlan).
 *
 * After Phase 3, storage calls (`allocate`/`reserve`) register their lifecycle callbacks
 * directly on the commitment. This class exists as a named subclass for debug labels
 * and `instanceof` checks.
 *
 * ## Lifecycle
 *
 * ```
 * pending ──fulfill()──► fulfilled
 *         └──cancel(reason)──► cancelled
 * ```
 *
 * ## GC guard
 *
 * Inherited from `Commitment`: if this object is GC'd while still pending, the finalization
 * registry logs an error with the creation stack — catching leaked allocations.
 *
 * ## Subclass
 *
 * Work plans (those with vehicle freelog) still need manual
 * `conclude` / `cancel` / `finally` in the handler;
 * they do **not** use this class.
 */
export class PlanCommitment extends Commitment {
	constructor(label: string) {
		super(label)
	}
}
