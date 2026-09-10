import { offloadRange } from 'engine-rules'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import type { Game } from 'ssh/game/game'
import type { Vehicle } from 'ssh/population/vehicle/entity'
import { axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'

/**
 * Destination picker for vehicles evicted from an alveolus tile (demolition,
 * stale-anchor undock, future bay-queue eviction). Every candidate is gated on
 * the existing `Tile.isClear` / `Tile.isBurdened` predicates at placement time,
 * plus a cheap pending-convey guard mirroring `Alveolus.isBurdened`.
 */
export function pickVehicleRelocationTarget(
	game: Game,
	vehicle: Vehicle,
	fromTile: Tile
): Tile | undefined {
	const fromCoord = toAxialCoord(fromTile.position)
	const fromHive = fromTile.content instanceof Alveolus ? fromTile.content.hive : undefined

	const hasPendingConvey = (tile: Tile): boolean => {
		const hive = tile.content instanceof Alveolus ? tile.content.hive : fromHive
		if (!hive) return false
		return !!hive.movingGoods.get(toAxialCoord(tile.position))?.length
	}

	const isUnburdenedSite = (tile: Tile): boolean => {
		if (tile === fromTile) return false
		if (!tile.isClear || tile.isBurdened) return false
		if (hasPendingConvey(tile)) return false
		return true
	}

	const sameHiveAlveoli: Alveolus[] = fromHive ? [...fromHive.alveoli] : []
	const byDistance = (a: Alveolus, b: Alveolus) =>
		axial.distance(fromCoord, toAxialCoord(a.tile.position)) -
		axial.distance(fromCoord, toAxialCoord(b.tile.position))

	// 1. Same-hive freight bay with a free tile — the vehicle ends "in" an alveolus.
	const bays = sameHiveAlveoli
		.filter((a) => a instanceof FreightBayAlveolus)
		.sort(byDistance)
	for (const bay of bays) {
		if (isUnburdenedSite(bay.tile)) return bay.tile
	}

	// 2. Same-hive non-bay alveolus tile (park on center).
	const others = sameHiveAlveoli
		.filter((a) => !(a instanceof FreightBayAlveolus))
		.sort(byDistance)
	for (const alveolus of others) {
		if (isUnburdenedSite(alveolus.tile)) return alveolus.tile
	}

	// 3. Nearest clear + unburdened tile within range that is actually drivable.
	const origin = axial.round(fromCoord)
	let best: { tile: Tile; dist: number } | undefined
	for (const tile of game.hex.tilesAround(origin, offloadRange)) {
		if (!isUnburdenedSite(tile)) continue
		const tc = axial.round(toAxialCoord(tile.position))
		const dist = axial.distance(origin, tc)
		if (best && dist >= best.dist) continue
		const reachable =
			axial.key(origin) === axial.key(tc) ||
			!!game.hex.findPathForVehicleServiceBorder(origin, tile.position, Number.POSITIVE_INFINITY)
		if (!reachable) continue
		best = { tile, dist }
	}
	return best?.tile
}

/**
 * Move an evicted vehicle onto `pickVehicleRelocationTarget`'s tile center.
 * Returns false when no unburdened candidate exists — callers keep the current
 * behavior (anchor center) so demolition never fails because relocation did.
 */
export function relocateVehicleFromAlveolus(
	game: Game,
	vehicle: Vehicle,
	fromTile: Tile
): boolean {
	const target = pickVehicleRelocationTarget(game, vehicle, fromTile)
	if (!target) return false
	// Re-check at placement time: a concurrent eviction may have taken the tile.
	if (!target.isClear || target.isBurdened) return false
	vehicle.position = { ...target.position }
	game.invalidateWorkPlanning('vehicle.relocate')
	game.enqueueInteractiveChange(fromTile)
	game.enqueueInteractiveChange(target)
	return true
}
