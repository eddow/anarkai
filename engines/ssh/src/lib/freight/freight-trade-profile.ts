import type { FreightNpcTradeStop } from 'ssh/freight/freight-line'
import type { Game } from 'ssh/game/game'

/**
 * Resolve a trade stop profile from the game registry, hydrating the stop in place.
 * Safe to call repeatedly; returns undefined when no matching settlement is registered.
 *
 * Kept in a tiny module so freight-stop-utility / npc-trade-stop can import it without
 * circular dependency on freight-line runtime exports.
 */
export function resolveFreightNpcTradeProfile(
	game: Game,
	trade: FreightNpcTradeStop
): FreightNpcTradeStop['profile'] | undefined {
	if (trade.profile) return trade.profile
	const profile = game.getSettlementTradeProfileAtCenter(trade.center)
	if (profile) {
		;(trade as { profile: FreightNpcTradeStop['profile'] }).profile = profile
	}
	return profile
}
