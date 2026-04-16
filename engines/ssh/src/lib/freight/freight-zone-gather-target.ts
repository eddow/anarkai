import type { Alveolus } from 'ssh/board/content/alveolus'
import type {
	FreightLineDefinition,
	FreightStop,
	FreightZoneDefinitionRadius,
} from 'ssh/freight/freight-line'
import {
	DEFAULT_GATHER_FREIGHT_RADIUS,
	findGatherRouteSegments,
	freightStopAnchorMatchesAlveolus,
	gatherLoadRadiusForLineAtStop,
	gatherSegmentAllowsGoodType,
	gatherSelectableGoodTypes,
} from 'ssh/freight/freight-line'
import type { Game } from 'ssh/game/game'
import type { Hive } from 'ssh/hive'
import type { Goods, GoodType } from 'ssh/types'
import type { Positioned } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'

export function goodsWith(goods: Goods, other: GoodType, qty: number = 1): Goods {
	const rv = { ...goods }
	rv[other] = (goods[other] || 0) + qty
	return rv
}

export function gatherZoneLoadStopForBay(
	line: FreightLineDefinition,
	bay: { hive: { name?: string }; name: string; tile: { position: Positioned } }
): (FreightStop & { zone: { kind: 'radius' } }) | undefined {
	for (const segment of findGatherRouteSegments(line)) {
		const load = line.stops[segment.loadStopIndex]
		const unload = line.stops[segment.unloadStopIndex]
		if (!load || !('zone' in load)) continue
		if (!unload || !('anchor' in unload)) continue
		if (!freightStopAnchorMatchesAlveolus(unload.anchor, bay)) continue
		if (load.zone.kind !== 'radius') continue
		return load as FreightStop & { zone: FreightZoneDefinitionRadius }
	}
	return undefined
}

export function aggregateHiveNeedTypes(game: Game): GoodType[] {
	const out = new Set<GoodType>()
	const seen = new Set<Hive>()
	for (const tile of game.hex.tiles) {
		const content = tile.content as Alveolus | undefined
		if (!content || !('hive' in content) || !content.hive) continue
		const hive = content.hive
		if (seen.has(hive)) continue
		seen.add(hive)
		for (const k of Object.keys(hive.needs)) out.add(k as GoodType)
	}
	return [...out]
}

/**
 * Walk-time / search budget for loose-good discovery inside a radius zone stop.
 * When `bayAlveolus` is provided, uses the same radius rule as road-fret bay gather-zone authority.
 */
export function zoneGatherSearchBudget(
	line: FreightLineDefinition,
	zoneStop: FreightStop & { zone: FreightZoneDefinitionRadius },
	bayAlveolus?: { hive: { name?: string }; name: string; tile: { position: Positioned } }
): number {
	if (bayAlveolus) {
		return gatherLoadRadiusForLineAtStop(line, bayAlveolus) ?? DEFAULT_GATHER_FREIGHT_RADIUS
	}
	return zoneStop.zone.radius
}

export interface ZoneGatherCarrier {
	hasRoom(goodType: GoodType): number
	readonly stock: Goods
}

/**
 * Picks the best loose-good tile to walk to for a gather **zone** stop (same scoring idea as
 * vehicle line-freight gather picks, scoped to one line/stop).
 */
export function pickGatherTargetInZoneStop(
	game: Game,
	line: FreightLineDefinition,
	zoneStop: FreightStop & { zone: FreightZoneDefinitionRadius },
	startPos: Positioned,
	hiveNeedTypes: readonly GoodType[],
	options?: {
		readonly carrier?: ZoneGatherCarrier
		readonly bayAlveolus?: { hive: { name?: string }; name: string; tile: { position: Positioned } }
		/** Extra predicate (e.g. hive slotted storage canStoreAll). */
		readonly canAcceptGood?: (goodType: GoodType) => boolean
	}
): { goodType: GoodType; path: Positioned[]; count: number } | undefined {
	const hex = game.hex
	const radius = zoneGatherSearchBudget(line, zoneStop, options?.bayAlveolus)
	let selectableGoods = gatherSelectableGoodTypes(line, hiveNeedTypes)
	const carry = options?.carrier
	const canAccept = options?.canAcceptGood
	if (carry) {
		const carriedGoods = Object.keys(carry.stock) as GoodType[]
		selectableGoods = [...new Set([...selectableGoods, ...carriedGoods])]
	}
	selectableGoods = selectableGoods.filter((good) => {
		if (!gatherSegmentAllowsGoodType(line, good)) return false
		if (carry && carry.hasRoom(good) <= 0) return false
		if (canAccept && !canAccept(good)) return false
		return true
	})
	if (selectableGoods.length === 0) return undefined

	const goodCounts = Object.fromEntries(selectableGoods.map((good) => [good, 0])) as Goods
	hex.findNearest(
		toAxialCoord(startPos)!,
		(pos: Positioned) => {
			const goodsAtTile = hex.looseGoods.getGoodsAt(pos)
			for (const good of goodsAtTile) {
				const gt = good.goodType as GoodType
				if (good.available && gt in goodCounts) goodCounts[gt]!++
			}
			return false
		},
		radius,
		false
	)
	const targetGood = Object.entries(goodCounts).reduce(
		(max, [good, count]) => (count > max.count ? { good: good as GoodType, count } : max),
		{ good: null as GoodType | null, count: 0 }
	)
	if (!targetGood.good) return undefined
	const result = hex.looseGoods.findNearestGoods(startPos, startPos, [targetGood.good], radius)
	if (!result?.path) return undefined
	return { goodType: targetGood.good, path: result.path, count: targetGood.count }
}

/**
 * True when there is no gatherable loose good left in this zone for the line's selectable types
 * (given carrier room), or when there is nothing left to pick.
 */
export function zoneGatherExhausted(
	game: Game,
	line: FreightLineDefinition,
	zoneStop: FreightStop & { zone: FreightZoneDefinitionRadius },
	startPos: Positioned,
	hiveNeedTypes: readonly GoodType[],
	options?: {
		readonly carrier?: ZoneGatherCarrier
		readonly bayAlveolus?: { hive: { name?: string }; name: string; tile: { position: Positioned } }
	}
): boolean {
	const pick = pickGatherTargetInZoneStop(game, line, zoneStop, startPos, hiveNeedTypes, options)
	return pick === undefined
}
