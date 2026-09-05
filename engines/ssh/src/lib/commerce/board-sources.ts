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

/** Every live hive on the board — O(hives) via the board's hive index (never a tile walk). */
export function listHives(game: Game): Hive[] {
	return game.hex.listHives()
}

/** How locally available a good is, for the project sourcing "nearest → not produced" sort. */
export type GoodAvailabilityKind = 'produced' | 'held' | 'unproduced'

export interface GoodAvailability {
	readonly kind: GoodAvailabilityKind
	/** Min hex distance to the nearest producing/holding hive (`Infinity` when unproduced). */
	readonly distance: number
}

/**
 * Measure how locally available `good` is relative to `coord`, for ordering a
 * project's bill in the sourcing UI:
 *
 * - `'produced'`  — some hive **produces** it (`normalizedDelta > 0`); we can make
 *   it ourselves. Ranked by nearest producer, regardless of current stock.
 * - `'held'`      — no producer, but a hive **holds** it (imported / leftover stock
 *   in a storage/pile, `normalizedDelta === 0`). Present, but not produced.
 * - `'unproduced'`— no producer and no stock anywhere.
 *
 * This keeps "can we make it?" (produced) distinct from "do we happen to have
 * some?" (held) — e.g. imported concrete sits in storage as `held`, never `produced`.
 */
export function measureGoodAvailability(
	game: Game,
	good: GoodType,
	coord: AxialCoord
): GoodAvailability {
	let bestProducerDistance = Number.POSITIVE_INFINITY
	let bestHolderDistance = Number.POSITIVE_INFINITY
	let produced = false
	let held = false
	for (const hive of listHives(game)) {
		const flow = hive.profile[good]
		if (!flow) continue
		const distance = estateDistanceToCoord(hive, coord)
		if (flow.normalizedDelta > 0) {
			// A genuine producer — we can make this good.
			produced = true
			if (distance < bestProducerDistance) bestProducerDistance = distance
		} else if (flow.normalizedDelta === 0 && flow.stock > 0) {
			// A holder (storage/pile) with stock present — imported or leftover.
			held = true
			if (distance < bestHolderDistance) bestHolderDistance = distance
		}
	}
	if (produced) return { kind: 'produced', distance: bestProducerDistance }
	if (held) return { kind: 'held', distance: bestHolderDistance }
	return { kind: 'unproduced', distance: Number.POSITIVE_INFINITY }
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
		// A net consumer (negative delta) is a sink, not a source: its own buffer
		// stock is being consumed, not surplus to export. Only producers (positive)
		// and holders (0) count as internal supply.
		if (flow.normalizedDelta < 0) continue
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
