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
import { isConstructionSiteShell, materialRemainingNeeds } from 'ssh/build-site'
import { listHives, measureExternalSourceOffers } from 'ssh/commerce/board-sources'
import type {
	GoodFlow,
	NeedSource,
	NetDeficit,
	NetDeficitLedger,
} from 'ssh/commerce/commerce-model'
import {
	compareSourceOffers,
	internalSourceAvailability,
	reserveFor,
	type SourcingPolicy,
} from 'ssh/commerce/sourcing'
import { RoadConstructionSite } from 'ssh/construction-road'
import type { FreightLineDefinition, FreightLineTarget } from 'ssh/freight/freight-line'
import { migrateV1FiltersToGoodsSelection } from 'ssh/freight/goods-selection-policy'
import type { Game } from 'ssh/game/game'
import { GameObject } from 'ssh/game/object'
import type { Hive } from 'ssh/hive/hive'
import type { Vehicle } from 'ssh/population/vehicle/entity'
import { type Project, projectSourcingMode } from 'ssh/project'
import type { Storage } from 'ssh/storage/storage'
import type { GoodType } from 'ssh/types/base'
import type { AxialCoord } from 'ssh/utils/axial'
import { axial } from 'ssh/utils/axial'
import { toAxialCoord } from 'ssh/utils/position'

/** Whether a line is a one-shot (self-deleting) order: `repeat: false` or a construction target. */
export function isOneShotLine(line: FreightLineDefinition): boolean {
	return line.repeat === false || (typeof line.repeat === 'object' && line.repeat !== null)
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

/** The construction structure a content object is, if it declares construction demand. */
function constructionTarget(content: unknown): FreightLineTarget | undefined {
	if (isConstructionSiteShell(content)) return content
	if (content instanceof RoadConstructionSite) return content as unknown as FreightLineTarget
	if (content instanceof UnBuiltLand && content.constructionSite && content.foundationStorage) {
		return content
	}
	return undefined
}

/** The owning project of a construction content object, if it was placed by a project. */
function contentProject(content: unknown): Project | undefined {
	if (!content || typeof content !== 'object' || !('project' in content)) return undefined
	return (content as { project?: Project }).project
}

/** The construction demand a structure declares (shell remaining needs, or foundation shortfall). */
function tileConstructionNeeds(content: unknown): Partial<Record<GoodType, number>> {
	if (content instanceof RoadConstructionSite) {
		return content.remainingNeeds as Partial<Record<GoodType, number>>
	}
	const target = constructionTarget(content)
	if (!target) return {}
	if (isConstructionSiteShell(target)) {
		return target.remainingNeeds as Partial<Record<GoodType, number>>
	}
	return materialRemainingNeeds(
		target.constructionSite!.foundationRequiredGoods,
		target.foundationStorage!
	) as Partial<Record<GoodType, number>>
}

/** The construction structure a line's `repeat` targets, if it is a {@link FreightLineTarget}. */
function lineTarget(line: FreightLineDefinition): FreightLineTarget | undefined {
	return typeof line.repeat === 'object' && line.repeat !== null ? line.repeat : undefined
}

/**
 * A one-shot line is fulfilled when its target construction structure no longer needs the
 * goods it unloads. **O(1)** for targeted lines (option B — the target's own remaining needs
 * is the authority, so "materials complete", "advanced past waiting_materials", or "demolished"
 * all read as fulfilled). Untargeted lines fall back to scanning their own radius zone.
 */
export function oneShotLineFulfilled(game: Game, line: FreightLineDefinition): boolean {
	const goods = oneShotLineUnloadGoods(line)
	if (goods.length === 0) return false
	const target = lineTarget(line)
	if (target) {
		const needs = tileConstructionNeeds(target)
		return !goods.some((good) => (needs[good] ?? 0) > 0)
	}
	const zones = lineUnloadRadiusZones(line)
	if (zones.length === 0) return false
	return zones.every((zone) => {
		for (const tile of game.hex.tilesAround(zone.center, zone.radius)) {
			const needs = tileConstructionNeeds(tile.content)
			if (goods.some((good) => (needs[good] ?? 0) > 0)) return false
		}
		return true
	})
}

/**
 * Remove fulfilled or aborted one-shot lines. Returns the number removed. An
 * aborted line is one with no stops, or (defensively) no demand it can serve.
 * Each line's fulfillment is checked against its own radius zone — no board scan.
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
	if (!('tile' in source) || !source.tile) return undefined
	return toAxialCoord(source.tile.position) ?? undefined
}

/** The storage a need's destination accepts goods into (shell / road site / alveolus / foundation). */
function needSourceStorage(source: NeedSource): Storage | undefined {
	if ('kind' in source && source.kind === 'project-forward') return undefined
	if (source instanceof RoadConstructionSite) return source.storage
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
 * Instant-credit deliveries credit the destination storage directly, so a need that
 * no longer declares demand counts as covered on the next pass (the ledger no
 * longer lists it). In-flight delivery orders are tracked separately via
 * `pendingDeliveryCover` below.
 */
function hasTransportCoveringNeed(game: Game, good: GoodType, coord: AxialCoord): boolean {
	for (const line of game.freightLines) {
		if (!lineUnloadGoods(line).includes(good)) continue
		// A targeted line covers `coord` only when it IS that structure's tile.
		const target = lineTarget(line)
		if (target) {
			const targetCoord = toAxialCoord(target.tile.position)
			if (targetCoord && axial.distance(targetCoord, coord) === 0) return true
			continue
		}
		const zones = lineUnloadRadiusZones(line)
		if (zones.length === 0) return true
		if (zones.some((zone) => axial.distance(zone.center, coord) <= zone.radius)) return true
	}
	if (pendingDeliveryCover.has(`${good}@${coord.q},${coord.r}`)) return true
	return false
}

/**
 * In-pass record of instant-credit deliveries (`good@q,r`). Cleared at the start of
 * each ticker pass (and each delivery pass for direct calls). Prevents the take branch
 * from spawning a duplicate self-haul line for a need the buy branch just credited
 * in the same tick — but must never survive into the next pass, or a stale entry
 * would suppress a fresh spawn for a recurring need at the same coord.
 */
const pendingDeliveryCover = new Set<string>()

/**
 * Spawn one-shot lines for construction deficits that have an internal source and
 * a free vehicle. Returns the number of lines created.
 *
 * **Local + radius**: each source hive scans `maxSelfHaulDistance` around its freight
 * bay for construction sites needing a good it can export above reserve, and routes a
 * `repeat: false` line bay → site. No board-wide ledger; the radius is the locality. A
 * site beyond every hive's radius (or with no internal source / no free vehicle) is left
 * in place — that is where {@link trySpawnConstructionDeliveries} (the buy + outside-carrier
 * branch) plugs in.
 */
export function trySpawnConstructionLines(game: Game, policy: SourcingPolicy): number {
	let spawned = 0
	const maxDistance = game.transportAutomation.maxSelfHaulDistance
	if (maxDistance <= 0) return 0

	for (const hive of listHives(game)) {
		const bay = hiveFreightBay(hive)
		if (!bay) continue
		const bayCoord = toAxialCoord(bay.tile.position)
		if (!bayCoord) continue

		// Goods this hive can export above its reserve keep-target (producer/holder).
		const exportable: GoodType[] = []
		for (const [good, flow] of Object.entries(hive.profile) as [GoodType, GoodFlow | undefined][]) {
			if (!flow || flow.normalizedDelta < 0) continue
			if (internalSourceAvailability(flow.stock, 0, reserveFor(policy, good)) <= 0) continue
			exportable.push(good)
		}
		if (exportable.length === 0) continue

		for (const tile of game.hex.tilesAround(bay.tile.position, maxDistance)) {
			const content = tile.content
			const target = content ? constructionTarget(content) : undefined
			if (!target) continue
			const needs = tileConstructionNeeds(target)
			const destCoord = toAxialCoord(tile.position)
			if (!destCoord) continue
			for (const good of exportable) {
				if ((needs[good] ?? 0) <= 0) continue
				// A project explicitly marked this good `buy` — leave it to the external branch.
				if (projectSourcingMode(contentProject(content), good) === 'buy') continue
				if (hasTransportCoveringNeed(game, good, destCoord)) continue
				const vehicle = findFreeVehicle(game)
				if (!vehicle) return spawned

				const selection = migrateV1FiltersToGoodsSelection([good])
				const line = game.addFreightLine({
					name: `auto:${good} @${destCoord.q},${destCoord.r}`,
					// The construction structure this line fulfills (read live — the line
					// dies when the site is satisfied/advanced/demolished).
					repeat: target,
					stops: [
						{
							loadSelection: selection,
							unloadSelection: selection,
							anchor: {
								kind: 'alveolus',
								hiveName: hive.name ?? '',
								alveolusType: 'freight_bay',
								coord: [bayCoord.q, bayCoord.r],
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
	}
	return spawned
}

/**
 * Order **deliveries** for construction deficits via outside carriers: buy the
 * good from the best-ranked NPC settlement sell offer (cheapest `priceVp` first,
 * nearest on price ties — see {@link compareSourceOffers}) and credit it directly
 * into the construction site's storage. Returns the number of deliveries ordered.
 *
 * This is the external branch of the internality slider ("buy + outsider brings").
 * For now the outsider is an **instant credit** (no physical carrier travel yet) —
 * `spendVp(price × qty)` then `storage.addGood`. The full cost/threshold formula
 * (and a real carrier entity) is a later slice; see `plans/spontaneous-lines.md`.
 *
 * A `take` override (or any player line already covering the need, including a
 * player-authored NPC trade-stop import line) suppresses the automated delivery —
 * to choose the buying place / bring it yourself, author an import line and mark
 * the good `take`.
 *
 * One delivery per **need** (per destination): two concurrent constructions of the
 * same good are each bought and credited in the same pass, subject to the wallet.
 */
export function trySpawnConstructionDeliveries(
	game: Game,
	_policy: SourcingPolicy,
	ledger?: NetDeficitLedger
): number {
	const snapshot = ledger ?? game.netDeficitLedger
	let delivered = 0
	pendingDeliveryCover.clear()
	for (const [good, net] of Object.entries(snapshot) as [GoodType, NetDeficit][]) {
		if ((net.deficit ?? 0) <= 0) continue
		for (const need of net.needs) {
			const storage = needSourceStorage(need.source)
			if (!storage) continue
			const destCoord = needSourceCoord(need.source)
			if (!destCoord) continue
			// A project explicitly marked this good `take` — leave it to the self-haul branch.
			if (projectSourcingMode(contentProject(need.source), good) === 'take') continue
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
			pendingDeliveryCover.add(`${good}@${destCoord.q},${destCoord.r}`)
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
		// Pass-scoped dedupe: drop the previous pass's instant-credit record so a
		// stale `good@q,r` never suppresses a fresh spawn. Entries added by the
		// delivery branch below are still seen by the take branch in this same pass.
		pendingDeliveryCover.clear()
		const auto = this.game.transportAutomation
		const policy: SourcingPolicy = {
			reserve: auto.reserve,
			internality: auto.internality,
		}
		// Self-haul + sweep are radius-local (no board scan). Delivery is the long-range
		// fallback and still reads the board-wide ledger — compute it once, only when autoBuy is on.
		const ledger = auto.autoBuy ? this.game.netDeficitLedger : undefined
		// Provisional internality rule: prefer self-haul at ≥0.5, delivery at <0.5.
		// `autoSpawn` gates self-haul, `autoBuy` gates delivery — independent toggles.
		if (auto.internality >= 0.5) {
			if (auto.autoSpawn) trySpawnConstructionLines(this.game, policy)
			if (auto.autoBuy) trySpawnConstructionDeliveries(this.game, policy, ledger)
		} else {
			if (auto.autoBuy) trySpawnConstructionDeliveries(this.game, policy, ledger)
			if (auto.autoSpawn) trySpawnConstructionLines(this.game, policy)
		}
		sweepOneShotLines(this.game)
	}
}
