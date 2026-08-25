/**
 * Board adapter — binds the pure sourcing core to live `Game` state.
 *
 * The commerce core (`deficit-ledger`, `sourcing`, `price-field`) is pure and
 * transport-agnostic; this module is the single place that walks the board and
 * turns live state into the measured snapshots those pure functions consume:
 *
 *   - `listHives(game)`            → the live `Hive` set (each is an `Estate`)
 *   - `measureInternalSourceOffers` → own-hive `SourceOffer`s (stock above reserve)
 *   - `measureExternalSourceOffers` → NPC-settlement `SourceOffer`s (price + distance)
 *
 * Together with `resolveSourcing`, a caller can answer "where do I get this
 * shortfall?" from the live board with no per-construction special-casing.
 */

import { Alveolus } from 'ssh/board/content/alveolus'
import type { Game } from 'ssh/game/game'
import type { Hive } from 'ssh/hive/hive'
import type { GoodType } from 'ssh/types/base'
import type { AxialCoord } from 'ssh/utils/axial'
import { axial } from 'ssh/utils/axial'
import { estateDistanceToCoord } from './price-field'
import {
	internalSourceAvailability,
	reserveFor,
	type SourceOffer,
	type SourcingPolicy,
} from './sourcing'

/** Every live hive on the board, deduped by identity from the alveoli that own them. */
export function listHives(game: Game): Hive[] {
	const seen = new Set<Hive>()
	for (const tile of game.hex.tiles) {
		const content = tile.content
		if (!(content instanceof Alveolus)) continue
		const hive = content.hive
		if (hive && !hive.isDestroyed) seen.add(hive)
	}
	return [...seen]
}

/**
 * Own-estate (internal) supply for `good`: each hive's exportable stock above its
 * reserve keep-target. `ownDemand` is 0 for now — a hive's own operating demand is
 * a later slice, so an internal source is "stock above reserve", not "stock above
 * reserve-and-own-consumption". Distance is footprint→demand-site min hex distance.
 */
export function measureInternalSourceOffers(
	game: Game,
	good: GoodType,
	demandCoord: AxialCoord,
	policy: SourcingPolicy
): SourceOffer[] {
	const reserve = reserveFor(policy, good)
	const offers: SourceOffer[] = []
	for (const hive of listHives(game)) {
		const flow = hive.profile[good]
		if (!flow) continue
		const available = internalSourceAvailability(flow.stock, 0, reserve)
		if (available <= 0) continue
		offers.push({
			source: hive,
			good,
			quantity: available,
			priceVp: 0,
			distance: estateDistanceToCoord(hive, demandCoord),
		})
	}
	return offers
}

/**
 * External (NPC settlement) supply for `good`: every sell offer, priced, distanced
 * from the settlement center to the demand site. These are always *ranked* by the
 * resolver (never preferred over internal); the quantity is nominally unbounded
 * (`Number.MAX_SAFE_INTEGER`) — NPC stock bounds are a later slice.
 */
export function measureExternalSourceOffers(
	game: Game,
	good: GoodType,
	demandCoord: AxialCoord
): SourceOffer[] {
	const offers: SourceOffer[] = []
	for (const profile of game.listSettlementTradeProfiles()) {
		const sell = profile.offers.find((offer) => offer.direction === 'sell' && offer.good === good)
		if (!sell) continue
		offers.push({
			source: profile,
			good,
			quantity: Number.MAX_SAFE_INTEGER,
			priceVp: sell.priceVp,
			distance: axial.distance(profile.center, demandCoord),
		})
	}
	return offers
}

/** All measured offers (internal first, external appended) for `good`. */
export function measureSourceOffers(
	game: Game,
	good: GoodType,
	demandCoord: AxialCoord,
	policy: SourcingPolicy
): SourceOffer[] {
	return [
		...measureInternalSourceOffers(game, good, demandCoord, policy),
		...measureExternalSourceOffers(game, good, demandCoord),
	]
}
