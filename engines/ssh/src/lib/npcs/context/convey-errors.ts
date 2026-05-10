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
