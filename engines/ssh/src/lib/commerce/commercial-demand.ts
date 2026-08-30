import type { ShopType } from 'engine-rules'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { Tile } from 'ssh/board/tile'
import { Shop } from 'ssh/commerce/shop'
import type { Game } from 'ssh/game/game'
import { GameObject } from 'ssh/game/object'
import type { AxialCoord } from 'ssh/utils/axial'
import { axial } from 'ssh/utils/axial'
import { toAxialCoord } from 'ssh/utils/position'
import { traces } from '../dev/debug.ts'

/**
 * Spontaneous commercial demand — the SimCity half's shop spawner.
 *
 * Mirrors `residential/demand.ts` for housing: on local pressure, commit a shop on a
 * clear, zoned, **road-adjacent** `UnBuiltLand` tile (the road-adjacency is the
 * "every estate must touch a road" delivery-tile rule from `plans/districts.md`).
 * The trigger is **cumulative observation**, not instantaneous pressure — a shop only
 * spawns after a candidate has had shoppers for {@link commercialObservationThreshold}
 * more passes than not, so a transient shortage never commits a shop and shops emerge
 * one by one rather than all at once.
 *
 * v1 scope: population-driven `grocery` only (food is the highest-urgency need). Type
 * diversification (production-seeded `construction_materials`, etc.) and the exact
 * spawn rule remain open — see `plans/districts.md`.
 */

/** Axial distance a candidate shop tile senses shoppers across. */
export const commercialShopSensingRadius = 12

/** Minimum seconds between commercial shop spawn evaluations. */
export const commercialShopSpawnCooldownSeconds = 2

/**
 * Net positive-observation evidence required to commit a shop. Each pass with ≥1
 * shopper adds 1, each pass with none subtracts 1 (clamped to `[0, threshold]`).
 */
export const commercialObservationThreshold = 3

/** The shop type the population-driven spawner places (food = highest urgency). */
export const commercialDefaultShopType: ShopType = 'grocery'

function countShoppersNear(game: Game, center: AxialCoord, radius: number): number {
	let n = 0
	for (const character of game.population) {
		const ac = toAxialCoord(character.position)
		if (!ac) continue
		if (axial.distance(ac, center) <= radius) n++
	}
	return n
}

/** Whether any of `coord`'s six borders carries a road (the delivery-tile rule). */
function isRoadAdjacent(game: Game, coord: AxialCoord): boolean {
	for (const neighbor of axial.neighbors(coord)) {
		const border = axial.linear([0.5, coord], [0.5, neighbor])
		if (game.hex.getRoadType(border)) return true
	}
	return false
}

interface CommercialCandidate {
	key: string
	tile: Tile
	shoppers: number
}

function collectCommercialCandidates(game: Game): CommercialCandidate[] {
	const out: CommercialCandidate[] = []
	// Candidates are the indexed commercial tiles (local by construction) — not a board walk.
	for (const coord of game.hex.zoneManager.commercialCoords) {
		const tile = game.hex.getTile(coord)
		if (!tile) continue
		if (!(tile.content instanceof UnBuiltLand)) continue
		if (tile.content.site) continue
		if (!tile.isClear) continue
		if (!isRoadAdjacent(game, coord)) continue
		out.push({
			key: axial.key(coord),
			tile,
			shoppers: countShoppersNear(game, coord, commercialShopSensingRadius),
		})
	}
	// Deterministic order so the "first shop wins" pick is reproducible.
	out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
	return out
}

function placeCommercialShop(game: Game, tile: Tile, shopType: ShopType): Shop {
	const shop = new Shop(tile, shopType)
	game.hex.setTileContent(tile, shop)
	const coord = toAxialCoord(tile.position)
	traces.commercial.log?.('[commercial] spawned shop', {
		q: coord?.q,
		r: coord?.r,
		shopType,
	})
	return shop
}

/**
 * Evaluate commercial demand and place **at most one** shop. Advances the per-tile
 * cumulative-observation evidence in `observations` (keyed by axial key): `+1` per
 * pass with shoppers, `−1` per empty pass, clamped to `[0, threshold]`. The first
 * candidate whose evidence reaches {@link commercialObservationThreshold} (highest
 * shopper count, then lowest coord) is committed and its evidence reset.
 *
 * @returns `true` when a shop was placed this pass.
 */
export function trySpawnCommercialShop(game: Game, observations: Map<string, number>): boolean {
	const candidates = collectCommercialCandidates(game)

	const seen = new Set(candidates.map((candidate) => candidate.key))
	for (const key of [...observations.keys()]) {
		if (!seen.has(key)) observations.delete(key)
	}

	let best: CommercialCandidate | undefined
	for (const candidate of candidates) {
		const acc = observations.get(candidate.key) ?? 0
		const next = Math.max(
			0,
			Math.min(commercialObservationThreshold, acc + (candidate.shoppers > 0 ? 1 : -1))
		)
		if (next === 0) observations.delete(candidate.key)
		else observations.set(candidate.key, next)
		if (next < commercialObservationThreshold) continue
		if (
			!best ||
			candidate.shoppers > best.shoppers ||
			(candidate.shoppers === best.shoppers && candidate.key < best.key)
		) {
			best = candidate
		}
	}

	if (!best) return false
	placeCommercialShop(game, best.tile, commercialDefaultShopType)
	observations.delete(best.key)
	return true
}

/**
 * Periodically evaluates commercial demand and may place a shop (cumulative
 * observation). Mirrors {@link ResidentialDemandTicker}; registered on `Game`
 * after world generation.
 */
export class CommercialDemandTicker extends GameObject {
	private cooldownSeconds = 0
	private readonly observations = new Map<string, number>()

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
		if (this.cooldownSeconds < commercialShopSpawnCooldownSeconds) return
		this.cooldownSeconds = 0
		trySpawnCommercialShop(this.game, this.observations)
	}
}
