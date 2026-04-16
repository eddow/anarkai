import { AllocationError } from 'ssh/storage/guard'

/**
 * Expected races / stale bookkeeping during convey: safe to roll back and retry.
 * Unexpected invariant breaks should use `assert` or a plain `Error` that is not caught here.
 */
export class ConveyStaleBookkeepingError extends Error {
	readonly kind = 'convey-stale-bookkeeping' as const
	constructor(message: string) {
		super(message)
		this.name = 'ConveyStaleBookkeepingError'
	}
}

function isConveyAllocationReason(reason: unknown): boolean {
	if (!reason || typeof reason !== 'object') return false
	const type = (reason as { type?: string }).type
	return type === 'convey.hop' || type === 'convey.path' || type === 'hive-transfer'
}

/** Whether `cleanupFailedConveyMovement` may have been appropriate (post-mutation rollback + retry). */
export function isConveyRollbackableError(error: unknown): boolean {
	if (error instanceof ConveyStaleBookkeepingError) return true
	if (error instanceof AllocationError && isConveyAllocationReason(error.reason)) return true
	return false
}
