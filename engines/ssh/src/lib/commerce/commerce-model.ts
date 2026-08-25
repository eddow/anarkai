/**
 * Commerce model — seed types & interfaces.
 *
 * This is the *structural* layer of the economy: the one primitive every read
 * (price, deficit, sourcing, wallet) consumes. It is deliberately NOT built on
 * the advertisement board (`GoodsRelations`); advertising is convey/movement
 * matching, whereas these types read an estate's rate + own-buffer stock directly.
 *
 * Price speaks of **estates**, not alveoli: an "estate" is the generalized
 * multi-tile economic unit — an industrial hive, a residential block, a mall, or
 * an NPC settlement are all estates for pricing (see the `Estate` interface).
 *
 * Implementations follow; this file pins the shapes first.
 */

import type { Alveolus } from 'ssh/board/content/alveolus'
import type { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { ConstructionSiteShell } from 'ssh/build-site'
import type { GoodType } from 'ssh/types/base'
import type { AxialCoord } from 'ssh/utils/axial'
import type { NpcSettlementTradeProfile } from './settlement-trade'

// ── The primitive (per estate) ───────────────────────────────────────────────

/** Signed, normalized flow rate for one good. + = producer, − = consumer, 0 = absent. */
export interface GoodFlow {
	/** signed, normalized delta (units/time); the sign *is* the producer/consumer role. */
	readonly normalizedDelta: number
	/** own-buffer stock (not transit, not neighbor); may exceed `capacity`. */
	readonly stock: number
	/**
	 * The fill-fraction denominator: a producer/consumer's own buffer size
	 * (`outputBufferSize`/`inputBufferSize`), or a holder's `1-buffer` target.
	 * The fill is **unclamped** — `stock` may exceed this.
	 */
	readonly capacity: number
}

/**
 * An estate's whole commerce profile: each good it produces/consumes. Absent
 * goods are omitted; **buffered** goods are excluded at construction time (not a
 * field). `Estate` replaces "hive" as the economic actor (see the `Estate`
 * interface below).
 */
export type EstateCommerceProfile = Partial<Record<GoodType, GoodFlow>>

/**
 * Effective pressure contribution of one good flow. The sign of `normalizedDelta`
 * replaces the producer/consumer enum:
 *
 *   + → supply =  |Δ| · (α + (1−α)·fill)
 *   − → demand = −|Δ| · (α + (1−α)·(1−fill))
 *
 * `rateField = Σ effectiveFlow(flow) · w(dist)`; `price = base · exp(−k·rateField)`.
 *
 * `fill = stock / capacity` is **unclamped**: an over-producing hive reports
 * `stock > capacity` → `fill > 1`, so a producer's `effectiveFlow` may exceed
 * `|Δ|`. The `α` floor is the only lower bound — there is no `[0,1]` clamp.
 */
export function effectiveFlow(flow: GoodFlow, alpha = 0.5): number {
	const f = flow.capacity > 0 ? flow.stock / flow.capacity : 0
	const magnitude = Math.abs(flow.normalizedDelta)
	return flow.normalizedDelta >= 0
		? magnitude * (alpha + (1 - alpha) * f)
		: -magnitude * (alpha + (1 - alpha) * (1 - f))
}

// ── Estate (the multi-tile economic unit) ────────────────────────────────────

/**
 * An **estate** is one building spanning one-to-several tiles gathered into a
 * single economic unit — a house, a shop, a mall, or an industrial hive. A
 * **settlement** is *not* an estate: it is a container of many estates (its
 * residential, commercial, and industrial buildings). It is what the price
 * field reads; "hive" stays the concrete industrial class.
 *
 * Kinds and how each derives its profile:
 *   - Industrial hive  → aggregate alveoli rates + buffers          (feeds price)
 *   - Residential building → pantry targets + population consumption (feeds price)
 *   - Commercial building → shelf stock + throughput                 (does NOT feed price)
 *   - NPC buildings   → sum the building's multi-role content        (feeds price)
 */
export interface Estate {
	/** the tiles this estate spans (each tile has distance 0 to itself). */
	readonly footprint: readonly AxialCoord[]
	/**
	 * structural read used by price, deficit, and sourcing alike. Must contain
	 * **only this estate's own buffers** — in-transit / holding / station stock
	 * is invisible to the price field (§5b) and must never be folded in here.
	 */
	readonly profile: EstateCommerceProfile
	/** commercial estates consume but must not feed the price field. */
	readonly feedsPriceField: boolean
	/**
	 * Minimum geometric (Manhattan/Euclidean) distance over footprint pairs —
	 * min dist(p, q) for p ∈ this.footprint, q ∈ other.footprint. Road-aware
	 * cost is route-only, not used here.
	 */
	distanceTo(other: Estate): number
}

// ── Price ────────────────────────────────────────────────────────────────────

/** One sampled point of the price field, at a commerce node. */
export interface PriceNode {
	readonly good: GoodType
	readonly position: AxialCoord
	readonly price: number
}

/**
 * The hybrid automatic price (per estate's `EstateCommerceProfile`):
 *
 *   price(p) = base_g · exp(−k · Σ effectiveFlow(flow_s) · w(dist(p, s)))
 *
 * Flow anchors, stock modulates; exponential over the rate field; frontier-faded.
 *
 * The tuning constants (`k`, `alpha`, `radius`, `fadeRadius`) live hard-coded in
 * `engine-rules` (next to `content/commerce.ts`), not here — this interface only
 * names them.
 */
export interface PriceFieldTuning {
	/** elasticity */
	readonly k: number
	/** stock-elasticity floor (the 0.5 → α knob) */
	readonly alpha: number
	/** influence radius (≥ generation radius) */
	readonly radius: number
	/** frontier fade radius */
	readonly fadeRadius: number
}

// ── Deficit (urgency) ────────────────────────────────────────────────────────

/**
 * The concrete runtime types that can declare a {@link NeededGood}. Each member
 * is distinguishable at runtime by an existing discriminator — no `kind` field:
 *   - `Alveolus`              → `instanceof Alveolus`
 *   - `ConstructionSiteShell` → `isConstructionSiteShell(source)`
 *   - `UnBuiltLand` (foundation phase) → `instanceof UnBuiltLand`
 * `ConstructionSiteShell` is disjoint from both classes (a shell is a `TileContent`
 * with `storage`, never an `Alveolus`/`UnBuiltLand`). Future contributors
 * (dwellings, commercial zones) extend this union.
 */
export type NeedSource = Alveolus | ConstructionSiteShell | UnBuiltLand

/**
 * One urgent (2-use) need declared by one contributing object. The object *is*
 * the origin — no redundant `origin`/`type` discriminant; callers narrow
 * `source` at runtime via `instanceof Alveolus` or `isConstructionSiteShell`
 * (or another existing type guard) like everywhere else.
 *
 * Commerce only ever sources `2-use`; `0-store`/`1-buffer` are internal
 * advertising priorities, not a deficit concern — so there is no priority field.
 */
export interface NeededGood {
	readonly good: GoodType
	readonly quantity: number
	/** the declaring object (alveolus, construction site, or foundation; future: road, dwelling, …). */
	readonly source: NeedSource
}

/**
 * Net need/excess for **one good**, board/group-scoped (not per-hive). A road,
 * city demolition, or standalone construction site is a contributor with no
 * hive. `demand`/`surplus` are the sums over all such contributors.
 */
export interface NetDeficit {
	/** Σ(target − stock) over 2-use needs. */
	readonly demand: number
	/** Σ(stock − reserve) — export availability. */
	readonly surplus: number
	/** max(0, demand − surplus − inFlight). */
	readonly deficit: number
	/** the individual 2-use needs, all of this good, summing to `demand`. */
	readonly needs: readonly NeededGood[]
}

/** The whole board's need/excess, keyed by good. */
export type NetDeficitLedger = Partial<Record<GoodType, NetDeficit>>

// ── Sourcing ─────────────────────────────────────────────────────────────────

/**
 * The single knob: don't export below it, don't import above it. The keep-target
 * is **the same number as a storage's `1-buffer` target** (`storageBuffers`) —
 * this `Reserve` is the commerce-facing name for it, not a second knob.
 */
export interface Reserve {
	/** fallback keep-target when no per-good value is set. */
	readonly defaultReserve: number
	readonly perGood?: Partial<Record<GoodType, number>>
}

/**
 * A source a project may buy from / sell to. **Estates** are the economic units:
 * own hives (and later houses/shops) are `Estate`s; NPC settlements trade via
 * their profile (a container, not yet an estate). NPC production hives and
 * other-player settlements join this union later.
 *
 * Load/unload and commercial transactions happen on the **corresponding
 * estate** (the specific house/shop/hive), not on the settlement container or
 * its city hall.
 */
export type Source = Estate | NpcSettlementTradeProfile

/** One "buy X of good G from source S" requirement; splittable across sources. */
export interface SourcingEntry {
	readonly good: GoodType
	readonly source: Source
	/** cap, or 'rest' = fill the remainder here. */
	readonly quota: number | 'rest'
}

export type ProjectSourcing = Partial<Record<GoodType, readonly SourcingEntry[]>>

// ── Wallet ───────────────────────────────────────────────────────────────────

export interface Wallet {
	readonly name: string
	readonly balanceVp: number
}

/** The hourly/daily drip (salary + consumption allowance). */
export interface Transfer {
	readonly to: Wallet
	readonly amountVp: number
	readonly periodSec: number
}
