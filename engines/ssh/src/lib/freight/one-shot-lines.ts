/**
 * One-shot freight lines — the lifecycle and spawner for `repeat: false` lines.
 *
 * A one-shot line is an automatic, self-deleting transport order: it is spawned
 * to cover a specific good deficit (a construction/operating need), and dissolves
 * itself once that deficit is fulfilled, or on abortion (the need vanished, no
 * resolvable source, a line with no stops). Recurring lines (`repeat` absent or
 * `true`) are player-authored and never touched here.
 *
 * The **spawner** is internal-first (a free vehicle self-hauls from an own hive's
 * bay to the construction site); the **delivery** branch (buy from an NPC settlement
 * + outside carrier) is the external half of the internality slider. Delivery is
 * currently an *instant credit* (`spendVp` + `storage.addGood`) — no physical carrier
 * yet — see `plans/spontaneous-lines.md`.
 */

import { Alveolus } from 'ssh/board/content/alveolus'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { isConstructionSiteShell } from 'ssh/build-site'
import { listHives, measureExternalSourceOffers } from 'ssh/commerce/board-sources'
import type { NeedSource } from 'ssh/commerce/commerce-model'
import {
	compareSourceOffers,
	internalSourceAvailability,
	reserveFor,
	type SourcingPolicy,
} from 'ssh/commerce/sourcing'
import type { FreightLineDefinition } from 'ssh/freight/freight-line'
import { migrateV1FiltersToGoodsSelection } from 'ssh/freight/goods-selection-policy'
import type { Game } from 'ssh/game/game'
import { GameObject } from 'ssh/game/object'
import type { Hive } from 'ssh/hive/hive'
import type { Vehicle } from 'ssh/population/vehicle/entity'
import type { Storage } from 'ssh/storage/storage'
import type { GoodType } from 'ssh/types/base'
import type { AxialCoord } from 'ssh/utils/axial'
import { axial } from 'ssh/utils/axial'
import { toAxialCoord } from 'ssh/utils/position'

/** Whether a line is a one-shot (self-deleting) order. */
export function isOneShotLine(line: FreightLineDefinition): boolean {
	return line.repeat === false
}

/**
 * The goods a line unloads to satisfy demand — its `unloadSelection` allow-list,
 * across all stops. An unrestricted selection (`defaultEffect: 'allow'` or no
 * policy) means "whatever is needed" — but that has no concrete good list, so it
 * contributes nothing here (a spawn decision only cares about *explicit* coverage).
 */
export function lineUnloadGoods(line: FreightLineDefinition): readonly GoodType[] {
	const goods: GoodType[] = []
	for (const stop of line.stops) {
		const policy = stop.unloadSelection
		if (!policy) continue
		if (policy.defaultEffect === 'allow') continue
		for (const rule of policy.goodRules) {
			if (rule.effect === 'allow' && !goods.includes(rule.goodType)) goods.push(rule.goodType)
		}
	}
	return goods
}

/** @deprecated Alias for {@link lineUnloadGoods} (a one-shot line is just a line). */
export function oneShotLineUnloadGoods(line: FreightLineDefinition): readonly GoodType[] {
	return lineUnloadGoods(line)
}

/**
 * A one-shot line is fulfilled when every good it unloads has no remaining
 * deficit in the board-scoped ledger (the construction/operating need it was
 * created to cover is gone).
 */
export function oneShotLineFulfilled(game: Game, line: FreightLineDefinition): boolean {
	const goods = oneShotLineUnloadGoods(line)
	if (goods.length === 0) return false
	const ledger = game.netDeficitLedger
	return goods.every((good) => (ledger[good]?.deficit ?? 0) <= 0)
}

/**
 * Remove fulfilled or aborted one-shot lines. Returns the number removed. An
 * aborted line is one with no stops, or (defensively) no demand it can serve.
 */
export function sweepOneShotLines(game: Game): number {
	let removed = 0
	for (const line of [...game.freightLines]) {
		if (!isOneShotLine(line)) continue
		if (line.stops.length === 0 || oneShotLineFulfilled(game, line)) {
			game.removeFreightLine(line)
			removed += 1
		}
	}
	return removed
}

/** The tile coord a need declares itself at (construction shell or foundation). */
function needSourceCoord(source: NeedSource): AxialCoord | undefined {
	return toAxialCoord(source.tile.position) ?? undefined
}

/** The storage a need's destination accepts goods into (shell / alveolus / foundation). */
function needSourceStorage(source: NeedSource): Storage | undefined {
	if (isConstructionSiteShell(source)) return source.storage
	if (source instanceof Alveolus) return source.storage
	if (source instanceof UnBuiltLand) return source.foundationStorage
	return undefined
}

/** A hive's freight-bay alveolus (the estate delivery tile), if any. */
function hiveFreightBay(hive: Hive): Alveolus | undefined {
	return [...hive.alveoli].find((alveolus) => alveolus.action?.type === 'road-fret')
}

/** A free vehicle: no served line and no operator. Vehicles are never spawned. */
function findFreeVehicle(game: Game): Vehicle | undefined {
	for (const vehicle of game.vehicles) {
		if (vehicle.servedLines.length === 0 && !vehicle.operator) return vehicle
	}
	return undefined
}

/** The radius-zone destinations a line unloads into (one-shot lines route bay → radius zone). */
function lineUnloadRadiusZones(
	line: FreightLineDefinition
): Array<{ center: AxialCoord; radius: number }> {
	const zones: Array<{ center: AxialCoord; radius: number }> = []
	for (const stop of line.stops) {
		if ('zone' in stop && stop.zone?.kind === 'radius') {
			zones.push({
				center: { q: stop.zone.center[0], r: stop.zone.center[1] },
				radius: stop.zone.radius,
			})
		}
	}
	return zones
}

/**
 * Whether an existing line already delivers `good` to `coord`. **Destination-aware**
 * for radius-zone lines (the one-shot spawner's own format): a line for site A must
 * not block a *different* construction site B, so two concurrent needs of the same
 * good are covered independently. A line that unloads `good` with no radius-zone
 * destination (bay↔bay or named-zone) is treated conservatively as covering, the
 * same as the previous good-scoped guard.
 *
 * Deliveries are instant credits (no in-flight state), so they cannot contribute a
 * `true` here; when a physical carrier lands, in-flight delivery orders will too.
 */
function hasTransportCoveringNeed(game: Game, good: GoodType, coord: AxialCoord): boolean {
	for (const line of game.freightLines) {
		if (!lineUnloadGoods(line).includes(good)) continue
		const zones = lineUnloadRadiusZones(line)
		if (zones.length === 0) return true
		if (zones.some((zone) => axial.distance(zone.center, coord) <= zone.radius)) return true
	}
	return false
}

/**
 * Spawn one-shot lines for construction deficits that have an internal source and
 * a free vehicle. Returns the number of lines created.
 *
 * Internal-first: for each deficit good, resolve own-hive supply (producer/holder
 * stock above reserve), pick the nearest source with a freight bay, and route a
 * `repeat: false` line from its bay to a radius zone over the construction site.
 * One line per **need** (per destination), so two concurrent constructions of the
 * same good each get their own line. Leaves the deficit in the ledger (and skips)
 * when there is no internal source or no free vehicle — that is where
 * {@link trySpawnConstructionDeliveries} (the buy + outside-carrier branch) plugs in.
 */
export function trySpawnConstructionLines(game: Game, policy: SourcingPolicy): number {
	const ledger = game.netDeficitLedger
	let spawned = 0
	for (const [good, net] of Object.entries(ledger) as [
		GoodType,
		NonNullable<(typeof ledger)[GoodType]>,
	][]) {
		if ((net?.deficit ?? 0) <= 0) continue
		const reserve = reserveFor(policy, good)

		// Eligible self-haul sources for this good (producer/holder stock above
		// reserve, with a freight bay). Resolved once per good, shared across needs.
		const bays: Array<{ hive: Hive; bay: Alveolus; bayCoord: AxialCoord }> = []
		for (const hive of listHives(game)) {
			const flow = hive.profile[good]
			if (!flow || flow.normalizedDelta < 0) continue
			if (internalSourceAvailability(flow.stock, 0, reserve) <= 0) continue
			const bay = hiveFreightBay(hive)
			if (!bay) continue
			const bayCoord = toAxialCoord(bay.tile.position)
			if (!bayCoord) continue
			bays.push({ hive, bay, bayCoord })
		}
		if (bays.length === 0) continue

		for (const need of net.needs) {
			const destCoord = needSourceCoord(need.source)
			if (!destCoord) continue
			if (hasTransportCoveringNeed(game, good, destCoord)) continue
			const picked = bays
				.map((bay) => ({ ...bay, distance: axial.distance(bay.bayCoord, destCoord) }))
				.sort((a, b) => a.distance - b.distance)[0]
			if (!picked) continue

			const vehicle = findFreeVehicle(game)
			if (!vehicle) continue

			const selection = migrateV1FiltersToGoodsSelection([good])
			const line = game.addFreightLine({
				name: `auto:${good} @${destCoord.q},${destCoord.r}`,
				repeat: false,
				stops: [
					{
						loadSelection: selection,
						unloadSelection: selection,
						anchor: {
							kind: 'alveolus',
							hiveName: picked.hive.name ?? '',
							alveolusType: 'freight_bay',
							coord: [picked.bayCoord.q, picked.bayCoord.r],
						},
					},
					{
						loadSelection: selection,
						unloadSelection: selection,
						zone: { kind: 'radius', center: [destCoord.q, destCoord.r], radius: 3 },
					},
				],
			})
			vehicle.assignFreightLine(line)
			spawned += 1
		}
	}
	return spawned
}

/**
 * Order **deliveries** for construction deficits via outside carriers: buy the
 * good from the nearest/cheapest NPC settlement and credit it directly into the
 * construction site's storage. Returns the number of deliveries ordered.
 *
 * This is the external branch of the internality slider ("buy + outsider brings").
 * For now the outsider is an **instant credit** (no physical carrier travel yet) —
 * `spendVp(price × qty)` then `storage.addGood`. The full cost/threshold formula
 * (and a real carrier entity) is a later slice; see `plans/spontaneous-lines.md`.
 *
 * One delivery per **need** (per destination): two concurrent constructions of the
 * same good are each bought and credited in the same pass, subject to the wallet.
 */
export function trySpawnConstructionDeliveries(game: Game, _policy: SourcingPolicy): number {
	const ledger = game.netDeficitLedger
	let delivered = 0
	for (const [good, net] of Object.entries(ledger) as [
		GoodType,
		NonNullable<(typeof ledger)[GoodType]>,
	][]) {
		if ((net?.deficit ?? 0) <= 0) continue
		for (const need of net.needs) {
			const storage = needSourceStorage(need.source)
			if (!storage) continue
			const destCoord = needSourceCoord(need.source)
			if (!destCoord) continue
			if (hasTransportCoveringNeed(game, good, destCoord)) continue

			const offers = measureExternalSourceOffers(game, good, destCoord).sort(compareSourceOffers)
			const offer = offers[0]
			if (!offer) continue

			const quantity = Math.min(need.quantity, offer.quantity)
			const price = offer.priceVp * quantity
			// Only buy what we can afford (external offers are always priced; a 0-price
			// offer would be an internal source and belongs in the self-haul branch).
			if (price <= 0 || !game.canAffordVp(price)) continue

			const added = storage.addGood(good, quantity)
			if (added <= 0) continue
			// Charge only for what was actually credited (addGood may clip to room).
			game.spendVp(offer.priceVp * added)
			delivered += 1
		}
	}
	return delivered
}

/**
 * Periodically spawns one-shot lines for deficits and sweeps fulfilled/aborted
 * ones. Mirrors {@link ResidentialDemandTicker}; registered on `Game` after world
 * generation so it can read the live deficit ledger.
 *
 * The automation config is read **live** from `game.transportAutomation` each pass
 * (not cached), so tuning `autoSpawn`/`autoBuy`/`internality`/`reserve`/`spawnCooldownSeconds`
 * takes effect immediately. `autoSpawn` gates self-haul lines, `autoBuy` gates deliveries —
 * independent toggles; with both off, the pass sweeps only.
 */
export class OneShotLineTicker extends GameObject {
	private cooldownSeconds = 0

	constructor(game: Game) {
		super(game)
		game.registerTickedObject(this)
	}

	override destroy(): void {
		this.game.unregisterTickedObject(this)
		super.destroy()
	}

	update(deltaSeconds: number): void {
		this.cooldownSeconds += deltaSeconds
		const cooldown = this.game.transportAutomation.spawnCooldownSeconds
		if (this.cooldownSeconds < cooldown) return
		this.cooldownSeconds = 0
		const auto = this.game.transportAutomation
		if (auto.autoSpawn || auto.autoBuy) {
			const policy: SourcingPolicy = {
				reserve: auto.reserve,
				internality: auto.internality,
			}
			// Provisional internality rule: prefer self-haul at ≥0.5, delivery at <0.5.
			// `autoSpawn` gates self-haul, `autoBuy` gates delivery — independent toggles.
			// Both share the "no double-cover" guard, so ordering is the preference.
			if (auto.internality >= 0.5) {
				if (auto.autoSpawn) trySpawnConstructionLines(this.game, policy)
				if (auto.autoBuy) trySpawnConstructionDeliveries(this.game, policy)
			} else {
				if (auto.autoBuy) trySpawnConstructionDeliveries(this.game, policy)
				if (auto.autoSpawn) trySpawnConstructionLines(this.game, policy)
			}
		}
		sweepOneShotLines(this.game)
	}
}
