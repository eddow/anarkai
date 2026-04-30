import { Commitment } from '../../commitment/commitment'
import type { AllocationBase } from '../../storage/storage'

/**
 * A `PlanCommitment` wraps the allocation lifecycle for a plan (TransferPlan or PickupPlan).
 *
 * Ownership:
 * - The commitment owns `allocation` and `vehicleAllocation` — it fulfills them on success,
 *   cancels them on failure.
 * - The plan object also carries direct `allocation` / `vehicleAllocation` references for
 *   consumers that need them during Phase 3 (when AllocationBase → Commitment).
 *
 * ## Lifecycle
 *
 * ```
 * pending ──fulfill()──► fulfilled
 *         └──cancel(reason)──► cancelled
 * ```
 *
 * On cancel: auto-cancels child allocations.
 * On fulfill: auto-fulfills child allocations.
 * On final: clears the allocation references (cleanup).
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
	allocation?: AllocationBase
	vehicleAllocation?: AllocationBase

	constructor(label: string) {
		super(label)

		// On cancel: auto-cancel child allocations
		this.onCancelled(() => {
			this.allocation?.cancel()
			this.vehicleAllocation?.cancel()
		})

		// On final: clear references so GC can reclaim the allocation objects
		this.onFinal(() => {
			this.allocation = undefined
			this.vehicleAllocation = undefined
		})
	}
}