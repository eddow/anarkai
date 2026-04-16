import type { FreightLineUtilityWeights } from 'engine-rules'
import type { FreightStopGoodsSnapshot } from 'ssh/freight/freight-stop-utility'
import type { GoodType } from 'ssh/types/base'

export interface FreightTransferableBreakdown {
	/** `min(source, sink)` per good. */
	readonly perGood: Readonly<Partial<Record<GoodType, number>>>
	/** Sum of per-good transferable units before vehicle cap. */
	readonly totalRaw: number
	/** After optional vehicle capacity cap. */
	readonly totalCapped: number
}

export interface FreightLineSegmentUtilityResult {
	readonly cargoScore: number
	readonly transferable: FreightTransferableBreakdown
	readonly travelDistance: number
	readonly travelTime: number
	readonly staleness: number
	/** `cargoScore - distancePenalty - timeBonus + stalenessBonus` (see implementation). */
	readonly score: number
	readonly distancePenalty: number
	readonly timePenalty: number
	readonly stalenessBonus: number
}

/**
 * Computes per-good `min(source, sink)` for allowed keys present in either snapshot.
 *
 * TODO: subtract reserved / in-flight quantities when vehicle cargo and allocations are modeled.
 */
export function transferableGoodsMin(
	source: FreightStopGoodsSnapshot,
	sink: FreightStopGoodsSnapshot,
	allowedGoods: ReadonlySet<GoodType>
): FreightTransferableBreakdown {
	const perGood: Partial<Record<GoodType, number>> = {}
	let totalRaw = 0
	for (const g of allowedGoods) {
		const s = source.perGood[g] ?? 0
		const k = sink.perGood[g] ?? 0
		const t = Math.min(s, k)
		perGood[g] = t
		if (t > 0) totalRaw += t
	}
	return { perGood, totalRaw, totalCapped: totalRaw }
}

/**
 * Applies an optional hard cap on total transferable units (e.g. wheelbarrow capacity).
 *
 * TODO: replace with per-good slot/capacity constraints when vehicle cargo rules are integrated.
 */
export function applyVehicleCapacityCap(
	breakdown: FreightTransferableBreakdown,
	vehicleCapacity: number | undefined
): FreightTransferableBreakdown {
	if (vehicleCapacity === undefined || !Number.isFinite(vehicleCapacity) || vehicleCapacity <= 0) {
		return { ...breakdown, totalCapped: breakdown.totalRaw }
	}
	return {
		...breakdown,
		totalCapped: Math.min(breakdown.totalRaw, vehicleCapacity),
	}
}

/**
 * Scalar relevance for a freight segment from source/sink snapshots and movement metadata.
 *
 * - `cargoScore` uses capped transferable total.
 * - Penalties subtract `weights.distance * travelDistance` and `weights.travelTime * travelTime`.
 * - `weights.staleness * staleness` is added (fairness / starvation).
 */
export function computeFreightLineSegmentUtility(args: {
	readonly source: FreightStopGoodsSnapshot
	readonly sink: FreightStopGoodsSnapshot
	readonly allowedGoods: ReadonlySet<GoodType>
	/**
	 * Optional total capacity for normalization (wheelbarrow, …). When set, `cargoScore` is
	 * `totalCapped / vehicleCapacity` in [0, 1]; otherwise `cargoScore = totalCapped`.
	 */
	readonly vehicleCapacity?: number
	readonly travelDistance: number
	readonly travelTime: number
	readonly staleness: number
	readonly weights: FreightLineUtilityWeights
}): FreightLineSegmentUtilityResult {
	const base = transferableGoodsMin(args.source, args.sink, args.allowedGoods)
	const capped = applyVehicleCapacityCap(base, args.vehicleCapacity)
	let cargoScore = capped.totalCapped
	if (
		args.vehicleCapacity !== undefined &&
		Number.isFinite(args.vehicleCapacity) &&
		args.vehicleCapacity > 0
	) {
		cargoScore = capped.totalCapped / args.vehicleCapacity
	}
	const distancePenalty = args.weights.distance * args.travelDistance
	const timePenalty = args.weights.travelTime * args.travelTime
	const stalenessBonus = args.weights.staleness * args.staleness
	const score = cargoScore - distancePenalty - timePenalty + stalenessBonus
	return {
		cargoScore,
		transferable: capped,
		travelDistance: args.travelDistance,
		travelTime: args.travelTime,
		staleness: args.staleness,
		score,
		distancePenalty,
		timePenalty,
		stalenessBonus,
	}
}
