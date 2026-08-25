/**
 * Sourcing resolution — origin-blind mapping of needs → concrete sources.
 *
 * The pure counterpart of the net-deficit ledger: the ledger declares *what* is
 * needed (`NeededGood[]`), this module decides *where* to get it. It is a pure,
 * shared function so player-authored projects and spontaneous construction use
 * the exact same resolution (a contributor's optional sourcing override is just
 * a pre-seeded `SourcingEntry[]` the caller prefers over this default).
 *
 * Resolution rule (decided, `plans/commerce-architecture.md` §"Sourcing policy"):
 * **internal-first** (own estates after their own demand + reserve), then
 * **external** (NPC settlements) ranked by price, then distance. The caller does
 * the board-walking and reserve math; this module only ranks + fills measured
 * `SourceOffer`s, so it stays testable and transport-agnostic.
 */

import type { GoodType } from 'ssh/types/base'
import type { NeededGood, Reserve, Source, SourcingEntry } from './commerce-model'

/** Global sourcing default = the reserve keep-target + the ranking rules. */
export interface SourcingPolicy {
	readonly reserve: Reserve
}

/**
 * One candidate source's measured supply for one good — a snapshot the caller
 * derives from the board (own stock above reserve, or an NPC offer).
 */
export interface SourceOffer {
	readonly source: Source
	readonly good: GoodType
	/** units the source can actually provide (already reserve-adjusted by the caller). */
	readonly quantity: number
	/** per-unit price in VP; `0` = internal/own source. */
	readonly priceVp: number
	/** hex distance from the demand site; `0` for own-estate internal sources. */
	readonly distance: number
}

/** The keep-target for a good (per-good override, else the default). */
export function reserveFor(policy: SourcingPolicy, good: GoodType): number {
	return policy.reserve.perGood?.[good] ?? policy.reserve.defaultReserve
}

/**
 * Own-estate availability after its own demand + reserve: `stock − ownDemand −
 * reserve`, floored at 0. This is the "internal-first" quantity — an internal
 * source may only export what is *above* its keep-target and its own needs.
 */
export function internalSourceAvailability(
	stock: number,
	ownDemand: number,
	reserve: number
): number {
	return Math.max(0, stock - ownDemand - reserve)
}

/**
 * Source ordering: internal (price 0) first, then external by price ascending,
 * then by distance ascending. Stock is **not** a tie-break — `quantity` only caps
 * how much a source fills, never which source is picked first.
 */
export function compareSourceOffers(a: SourceOffer, b: SourceOffer): number {
	const ai = a.priceVp <= 0 ? 0 : 1
	const bi = b.priceVp <= 0 ? 0 : 1
	if (ai !== bi) return ai - bi
	if (a.priceVp !== b.priceVp) return a.priceVp - b.priceVp
	return a.distance - b.distance
}

/**
 * Resolve a set of needs against measured source offers into a concrete, splittable
 * sourcing plan. Per good: internal sources fill greedily with **concrete numeric
 * quotas**, then external sources fill in rank order. The **last external source
 * used** is marked `quota: 'rest'` — the open-ended auto-fill catch-all (the
 * editable "own hive 40 + NPC settlement rest" shape) — while earlier external
 * sources keep concrete quotas.
 *
 * Unsatisfiable remainder is dropped from the plan (the deficit stays visible in
 * the ledger — resolution never fabricates supply).
 */
export function resolveSourcing(
	needs: readonly NeededGood[],
	offers: readonly SourceOffer[],
	_policy: SourcingPolicy
): SourcingEntry[] {
	const demandByGood = new Map<GoodType, number>()
	for (const need of needs) {
		demandByGood.set(need.good, (demandByGood.get(need.good) ?? 0) + need.quantity)
	}

	const offersByGood = new Map<GoodType, SourceOffer[]>()
	for (const offer of offers) {
		const list = offersByGood.get(offer.good) ?? []
		list.push(offer)
		offersByGood.set(offer.good, list)
	}
	for (const list of offersByGood.values()) list.sort(compareSourceOffers)

	const entries: SourcingEntry[] = []
	for (const [good, demand] of demandByGood) {
		if (demand <= 0) continue
		let remaining = demand
		let lastExternalIndex = -1
		for (const offer of offersByGood.get(good) ?? []) {
			if (remaining <= 0) break
			const available = Math.max(0, offer.quantity)
			if (available <= 0) continue
			const take = Math.min(remaining, available)
			entries.push({ good, source: offer.source, quota: take })
			if (offer.priceVp > 0) lastExternalIndex = entries.length - 1
			remaining -= take
		}
		if (lastExternalIndex >= 0) {
			const last = entries[lastExternalIndex]!
			entries[lastExternalIndex] = { ...last, quota: 'rest' }
		}
	}
	return entries
}
