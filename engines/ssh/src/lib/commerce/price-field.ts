/**
 * Price field — the hybrid automatic price, pure over estates.
 *
 * `price(p) = base_g · exp(−k · Σ_s effectiveFlow(flow_s) · w(dist(p, s)))`
 *
 * Flow anchors, stock modulates (via {@link effectiveFlow}), exponential mapping;
 * `w(d) = max(0, 1 − (d/R)²)` is the squared-distance weight, `R` ≥ generation
 * radius. This module is pure and transport/board-agnostic: it samples the field
 * at an arbitrary coordinate over a set of {@link Estate}s.
 *
 * **Base price** is a caller parameter (typically `goods[good].baseValueVp`) —
 * the field maps to a multiplicative deviation from that base, never sets it.
 *
 * The **frontier fade** (deviation → 0 at the generated edge) is applied by a
 * board-aware caller and lives outside this module (it needs the generation
 * frontier, not just estates). `fadeRadius` is therefore tuned **together with
 * generation** — see `plans/commerce-architecture.md`.
 */

import { commerce } from 'engine-rules'
import type { GoodType } from 'ssh/types/base'
import type { AxialCoord } from 'ssh/utils/axial'
import { axial } from 'ssh/utils/axial'
import { type Estate, effectiveFlow, type PriceFieldTuning } from './commerce-model'

/**
 * Squared-distance influence weight. `max(0, 1 − (d/R)²)`; a point inside the
 * radius influences fully (weight 1 at `d = 0`), tapering to 0 at the radius edge.
 */
export function influenceWeight(distance: number, radius: number): number {
	if (radius <= 0) return distance <= 0 ? 1 : 0
	const x = distance / radius
	return Math.max(0, 1 - x * x)
}

/** Min hex distance from an estate's footprint to an arbitrary coordinate. */
export function estateDistanceToCoord(estate: Estate, coord: AxialCoord): number {
	let min = Number.POSITIVE_INFINITY
	for (const tile of estate.footprint) {
		const d = axial.distance(tile, coord)
		if (d < min) min = d
	}
	return Number.isFinite(min) ? min : 0
}

/**
 * The summed, distance-weighted rate field at `position` for `good`:
 * `Σ effectiveFlow(flow) · w(dist)` over every price-feeding estate holding that
 * good. Commercial estates (`feedsPriceField = false`) are excluded.
 */
export function rateFieldAt(
	estates: readonly Estate[],
	good: GoodType,
	position: AxialCoord,
	tuning: PriceFieldTuning
): number {
	let field = 0
	for (const estate of estates) {
		if (!estate.feedsPriceField) continue
		const flow = estate.profile[good]
		if (!flow) continue
		const dist = estateDistanceToCoord(estate, position)
		field += effectiveFlow(flow, tuning.alpha) * influenceWeight(dist, tuning.radius)
	}
	return field
}

/**
 * Sample the automatic price at `position`: `base · exp(−k · rateField)`.
 * `base` is the caller-provided base value (typically `goods[good].baseValueVp`).
 */
export function priceAt(
	estates: readonly Estate[],
	good: GoodType,
	position: AxialCoord,
	tuning: PriceFieldTuning,
	base: number
): number {
	return base * Math.exp(-tuning.k * rateFieldAt(estates, good, position, tuning))
}

/** The default tuning, pulled from `engine-rules` (see `commerce.priceField`). */
export const defaultPriceFieldTuning: PriceFieldTuning = commerce.priceField
