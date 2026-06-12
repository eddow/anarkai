import { effect } from 'mutts'
import type { Tile } from 'ssh/board/tile'
import {
	type ConstructionSiteState,
	normalizeConstructionSiteState,
	setConstructionDeliveredGoods,
} from 'ssh/construction-state'
import type { Storage } from 'ssh/storage/storage'
import type { GoodType } from 'ssh/types/base'
import type { ExchangePriority, GoodsRelations } from 'ssh/utils/advertisement'
import { traces } from './dev/debug.ts'

/**
 * Shared construction-shell helpers for in-progress sites (`BuildAlveolus`, `BuildDwelling`).
 * Keeps material math and phase sync identical across hive and residential shells (roadmap:
 * one workflow, multiple consumers).
 */

// ---------------------------------------------------------------------------
// In-transit reservation model for fixed-quantity consumers
// ---------------------------------------------------------------------------

/**
 * Records goods that a vehicle has committed to deliver to this construction site.
 *
 * Kept in a module-level WeakMap so that {@link BuildAlveolus} and {@link BuildDwelling}
 * constructors stay untouched; all reservation logic lives here.
 */
export interface InTransitReservation {
	readonly vehicleUid: string
	readonly goodType: GoodType
	readonly quantity: number
	/** Game tick after which this reservation is considered stale (algorithm bug). */
	readonly expiresAtTick: number
}

type ReservationMap = Map<string, InTransitReservation>
const inTransitRegistry = new WeakMap<ConstructionSiteShell, ReservationMap>()

function ensureRegistry(shell: ConstructionSiteShell): ReservationMap {
	let map = inTransitRegistry.get(shell)
	if (!map) {
		map = new Map()
		inTransitRegistry.set(shell, map)
	}
	return map
}

function reservationKey(vehicleUid: string, goodType: GoodType): string {
	return `${vehicleUid}:${goodType}`
}

/** Sum of in-transit quantities for one good type across all reserving vehicles. */
function inTransitQuantity(shell: ConstructionSiteShell, goodType: GoodType): number {
	const map = inTransitRegistry.get(shell)
	if (!map) return 0
	let total = 0
	for (const res of map.values()) {
		if (res.goodType === goodType) total += res.quantity
	}
	return total
}

/**
 * Per-good remaining needs with in-transit vehicle reservations subtracted.
 *
 * All callers that measure need for **load-decision** purposes must use this instead of raw
 * {@link ConstructionSiteShell.remainingNeeds} so two vehicles cannot double-load for the
 * same fixed-quantity need.
 */
export function effectiveRemainingNeeds(shell: ConstructionSiteShell): Record<string, number> {
	const raw = shell.remainingNeeds
	const map = inTransitRegistry.get(shell)
	if (!map || map.size === 0) return raw
	const result: Record<string, number> = {}
	for (const [good, need] of Object.entries(raw)) {
		const inTransit = inTransitQuantity(shell, good as GoodType)
		const effective = Math.max(0, need - inTransit)
		if (effective > 0) result[good] = effective
	}
	return result
}

/** Reserve in-transit delivery for `vehicleUid` of `quantity` units of `goodType`. */
export function reserveInTransit(
	shell: ConstructionSiteShell,
	vehicleUid: string,
	goodType: GoodType,
	quantity: number,
	expiresAtTick: number
): void {
	if (quantity <= 0) return
	const map = ensureRegistry(shell)
	const key = reservationKey(vehicleUid, goodType)
	const existing = map.get(key)
	if (existing) {
		// Vehicle is re-reserving the same good: update quantity and expiry.
		map.set(key, {
			vehicleUid,
			goodType,
			quantity: existing.quantity + quantity,
			expiresAtTick: Math.max(existing.expiresAtTick, expiresAtTick),
		})
	} else {
		map.set(key, { vehicleUid, goodType, quantity, expiresAtTick })
	}
}

/** Cancel all in-transit reservations from `vehicleUid` on this shell. */
export function cancelVehicleInTransitReservations(
	shell: ConstructionSiteShell,
	vehicleUid: string
): number {
	const map = inTransitRegistry.get(shell)
	if (!map) return 0
	let cancelled = 0
	for (const [key, res] of map) {
		if (res.vehicleUid === vehicleUid) {
			map.delete(key)
			cancelled++
		}
	}
	return cancelled
}

/** Cancel **all** in-transit reservations on this shell (e.g. construction site demolished). */
export function cancelAllInTransitReservations(shell: ConstructionSiteShell): number {
	const map = inTransitRegistry.get(shell)
	if (!map) return 0
	const count = map.size
	map.clear()
	return count
}

/**
 * Returns reservations whose `expiresAtTick` has passed — stale reservations indicate an
 * algorithm bug (vehicle never delivered what it reserved).
 */
export function staleInTransitReservations(
	shell: ConstructionSiteShell,
	nowTick: number
): InTransitReservation[] {
	const map = inTransitRegistry.get(shell)
	if (!map) return []
	const stale: InTransitReservation[] = []
	for (const res of map.values()) {
		if (res.expiresAtTick < nowTick) stale.push(res)
	}
	return stale
}

/**
 * Clean up stale reservations, logging a warning trace for each.
 * Returns the number of reservations cleaned up.
 */
export function cleanupStaleInTransitReservations(
	shell: ConstructionSiteShell,
	nowTick: number
): number {
	const stale = staleInTransitReservations(shell, nowTick)
	if (stale.length === 0) return 0
	const map = inTransitRegistry.get(shell)
	if (!map) return 0
	for (const res of stale) {
		map.delete(reservationKey(res.vehicleUid, res.goodType))
		traces.vehicle.warn?.('inTransit.stale', {
			siteUid: (shell as { uid?: string }).uid,
			vehicleUid: res.vehicleUid,
			goodType: res.goodType,
			quantity: res.quantity,
			expiredAtTick: res.expiresAtTick,
			nowTick,
		})
	}
	return stale.length
}

/**
 * Cancel all in-transit reservations associated with `vehicleUid` across all known
 * {@link ConstructionSiteShell} instances reachable from `tiles`.
 */
export function cancelVehicleReservationsOnSites(
	tiles: Iterable<{ content: unknown }>,
	vehicleUid: string
): number {
	let total = 0
	for (const tile of tiles) {
		if (isStandaloneConstructionSiteShell(tile.content)) {
			total += cancelVehicleInTransitReservations(tile.content, vehicleUid)
		}
	}
	return total
}

/**
 * Run stale-reservation cleanup across all construction sites reachable from `tiles`.
 * Returns total stale reservations cleaned up.
 */
export function cleanupStaleReservationsOnAllSites(
	tiles: Iterable<{ content: unknown }>,
	nowTick: number
): number {
	let total = 0
	for (const tile of tiles) {
		if (isStandaloneConstructionSiteShell(tile.content)) {
			total += cleanupStaleInTransitReservations(tile.content, nowTick)
		}
	}
	return total
}

/**
 * Estimate route cycle ticks for a line: sum of straight-line distances between
 * consecutive stops × a conservative hex cost per distance unit.
 */
export function estimateRouteCycleTicks(
	stopPositions: readonly (readonly [number, number])[]
): number {
	const HEX_TICK_COST = 10 // conservative ticks per hex traversed
	let total = 0
	for (let i = 0; i < stopPositions.length; i++) {
		const [q1, r1] = stopPositions[i]
		const [q2, r2] = stopPositions[(i + 1) % stopPositions.length]
		const dist = Math.abs(q2 - q1) + Math.abs(r2 - r1)
		total += dist * HEX_TICK_COST
	}
	// Add dock/unload overhead per stop
	total += stopPositions.length * 20
	return total
}

export interface ConstructionMaterialShell {
	readonly constructionSite: ConstructionSiteState
	readonly storage: Storage
	readonly destroyed: boolean
	readonly uid?: string
}

/**
 * Shared structural contract for any in-progress construction shell on a tile.
 *
 * Runtime classes differ by target, but construction-facing semantics should stay identical.
 */
export interface ConstructionSiteShell extends ConstructionMaterialShell {
	readonly tile: Tile
	readonly working: boolean
	constructionWorkSecondsApplied: number
	canTake(goodType: GoodType, priority: ExchangePriority): boolean
	canGive(goodType: GoodType, priority: ExchangePriority): boolean
	readonly requiredGoods: Record<GoodType, number>
	readonly remainingNeeds: Record<string, number>
	readonly advertisedNeeds: Record<string, number>
	readonly isReady: boolean
	readonly workingGoodsRelations: GoodsRelations
}

/** Compatibility alias while callers migrate to `ConstructionSiteShell`. */
export type BuildSite = ConstructionSiteShell

export function isConstructionSiteShell(value: unknown): value is ConstructionSiteShell {
	return (
		typeof value === 'object' &&
		value !== null &&
		'tile' in value &&
		'constructionSite' in value &&
		'storage' in value &&
		'constructionWorkSecondsApplied' in value
	)
}

/** Compatibility alias while callers migrate to `isConstructionSiteShell`. */
export const isBuildSite = isConstructionSiteShell

/** Standalone construction shells (`BuildAlveolus`, `BuildDwelling`, ...). */
export function isStandaloneConstructionSiteShell(
	content: unknown
): content is ConstructionSiteShell {
	return isConstructionSiteShell(content)
}

/** Compatibility alias while callers migrate to `isStandaloneConstructionSiteShell`. */
export const isStandaloneBuildSiteShell = isStandaloneConstructionSiteShell

export function materialRemainingNeeds(
	requiredGoods: Partial<Record<GoodType, number>>,
	storage?: Storage
): Record<string, number> {
	const needs: Record<string, number> = {}
	if (!storage?.stock) {
		for (const [good, qty] of Object.entries(requiredGoods)) {
			const n = qty ?? 0
			if (n > 0) needs[good] = n
		}
		return needs
	}
	for (const [good, qty] of Object.entries(requiredGoods)) {
		const goodType = good as GoodType
		const target = qty ?? 0
		const have = storage.available(goodType) || 0
		if (have < target) needs[good] = target - have
	}
	return needs
}

export function materialAdvertisedNeeds(
	requiredGoods: Partial<Record<GoodType, number>>,
	storage: Storage
): Record<string, number> {
	const needs: Record<string, number> = {}
	for (const [good, qty] of Object.entries(requiredGoods)) {
		const goodType = good as GoodType
		const room = Math.max(0, storage.hasRoom(goodType))
		if (room > 0) needs[good] = Math.min(qty ?? 0, room)
	}
	return needs
}

export function materialDemandRelations(
	requiredGoods: Partial<Record<GoodType, number>>,
	advertisedNeeds: Record<string, number>,
	destroyed: boolean
): GoodsRelations {
	if (destroyed) return {}
	return Object.fromEntries(
		Object.entries(requiredGoods)
			.filter(([goodType]) => (advertisedNeeds[goodType] ?? 0) > 0)
			.map(([goodType]) => [
				goodType as GoodType,
				{ advertisement: 'demand', priority: '2-use' as const },
			])
	)
}

export function materialsComplete(shell: ConstructionMaterialShell): boolean {
	return (
		Object.keys(
			materialRemainingNeeds(
				normalizeConstructionSiteState(shell.constructionSite).requiredGoods,
				shell.storage
			)
		).length === 0 && !shell.destroyed
	)
}

export function buildSiteCanTake(
	this: ConstructionSiteShell,
	goodType: GoodType,
	_priority: ExchangePriority
): boolean {
	if (!this.working) return false
	return (this.advertisedNeeds[goodType] ?? 0) > 0 && !this.destroyed
}

export function buildSiteCanGive(
	this: ConstructionSiteShell,
	_goodType: GoodType,
	_priority: ExchangePriority
): boolean {
	return false
}

interface InstallBuildSitePrototypeOptions {
	readonly aliasGoodsRelations?: boolean
}

/**
 * Installs the shared `ConstructionSiteShell` accessors on classes whose inheritance trees differ
 * but whose construction semantics are the same.
 */
export function installBuildSitePrototype(
	prototype: object,
	options: InstallBuildSitePrototypeOptions = {}
): void {
	Object.defineProperties(prototype, {
		canTake: {
			value: buildSiteCanTake,
			writable: true,
			configurable: true,
		},
		canGive: {
			value: buildSiteCanGive,
			writable: true,
			configurable: true,
		},
		requiredGoods: {
			get(this: ConstructionSiteShell) {
				return normalizeConstructionSiteState(this.constructionSite).requiredGoods as Record<
					GoodType,
					number
				>
			},
			configurable: true,
		},
		remainingNeeds: {
			get(this: ConstructionSiteShell) {
				return materialRemainingNeeds(
					normalizeConstructionSiteState(this.constructionSite).requiredGoods,
					this.storage
				)
			},
			configurable: true,
		},
		advertisedNeeds: {
			get(this: ConstructionSiteShell) {
				return materialAdvertisedNeeds(
					normalizeConstructionSiteState(this.constructionSite).requiredGoods,
					this.storage
				)
			},
			configurable: true,
		},
		isReady: {
			get(this: ConstructionSiteShell) {
				return materialsComplete(this)
			},
			configurable: true,
		},
		workingGoodsRelations: {
			get(this: ConstructionSiteShell) {
				return materialDemandRelations(
					normalizeConstructionSiteState(this.constructionSite).requiredGoods,
					this.advertisedNeeds,
					this.destroyed
				)
			},
			configurable: true,
		},
		...(options.aliasGoodsRelations
			? {
					goodsRelations: {
						get(this: ConstructionSiteShell) {
							return this.workingGoodsRelations
						},
						configurable: true,
					},
				}
			: {}),
	})
}

/**
 * Syncs `constructionSite` phase and delivered-goods snapshot from shell storage (shared by
 * `BuildAlveolus` and `BuildDwelling`).
 */
export function registerConstructionMaterialPhaseEffect(
	debugLabel: string,
	shell: ConstructionMaterialShell
): void {
	effect`build-site:${debugLabel}`(() => {
		const constructionSite = normalizeConstructionSiteState(shell.constructionSite)
		const deliveredGoods = (shell.storage?.stock ?? {}) as Partial<Record<GoodType, number>>
		setConstructionDeliveredGoods(constructionSite, deliveredGoods)
		if (shell.destroyed) {
			if (constructionSite.workSecondsApplied < constructionSite.recipe.workSeconds) {
				constructionSite.phase = 'failed'
			}
			return
		}
		if (!materialsComplete(shell)) {
			if (constructionSite.phase !== 'building') {
				constructionSite.phase = 'waiting_materials'
			}
			return
		}
		if (constructionSite.phase !== 'building') {
			constructionSite.phase = 'waiting_construction'
		}
	})
}
