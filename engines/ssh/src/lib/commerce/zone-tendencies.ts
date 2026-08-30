import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { ZoneDefinition } from 'ssh/board/zone'
import { isConstructionSiteShell, materialRemainingNeeds } from 'ssh/build-site'
import { commercialShopSensingRadius } from 'ssh/commerce/commercial-demand'
import { Shop } from 'ssh/commerce/shop'
import type { Game } from 'ssh/game/game'
import { residentialHousingDemandRadius } from 'ssh/residential/constants'
import type { GoodType } from 'ssh/types/base'
import type { AxialCoord } from 'ssh/utils/axial'
import { axial } from 'ssh/utils/axial'
import { toAxialCoord } from 'ssh/utils/position'

/**
 * Zone study — the aggregate "what is building here" read for a zone.
 *
 * The SimCity half's counterpart to the alveolus→hive drill-down: a zone is a
 * container of tiles, and this snapshot surfaces the **tendencies** the spontaneous
 * spawners are accumulating against it — per-good demand (construction needs inside
 * the zone) and offer (stock held inside the zone), the structural counts
 * (dwellings / under-construction / shops), and the two spawn-pressure signals
 * (`housingPressure` for residential, `shoppers` for commercial). Consumed by the
 * zone inspector; pure and board-walking, so it stays testable.
 */

export interface ZoneTendencies {
	/** Construction demand declared by needs whose source tile is inside this zone. */
	readonly demand: Partial<Record<GoodType, number>>
	/** Commerce the commercial zone needs: shop restock shortfall (capacity − stock), summed per good. */
	readonly commerceNeed: Partial<Record<GoodType, number>>
	/** Stock held in this zone's storages/shops/dwellings (offer-side). */
	readonly offer: Partial<Record<GoodType, number>>
	/** Completed dwellings inside the zone. */
	readonly dwellings: number
	/** In-progress dwelling construction (shells / residential projects) inside the zone. */
	readonly underConstruction: number
	/** Shop tiles inside the zone. */
	readonly shops: number
	/** Residential spawn signal: people near − free dwelling slots (clamped ≥ 0). */
	readonly housingPressure: number
	/** Commercial spawn signal: people within the shop sensing radius of the zone center. */
	readonly shoppers: number
}

function countPeopleNear(game: Game, center: AxialCoord, radius: number): number {
	let n = 0
	for (const character of game.population) {
		const ac = toAxialCoord(character.position)
		if (!ac) continue
		if (axial.distance(ac, center) <= radius) n++
	}
	return n
}

/** Stock held in a tile's storage (alveolus / dwelling / shop / shell / foundation). */
function tileStock(game: Game, coord: AxialCoord): Partial<Record<GoodType, number>> {
	const tile = game.hex.getTile(coord)
	const content = tile?.content
	const storage =
		content && 'storage' in content
			? (content as { storage?: { stock?: object } }).storage
			: undefined
	const foundation = content instanceof UnBuiltLand ? content.foundationStorage : undefined
	const stock = (storage?.stock ?? foundation?.stock ?? {}) as Partial<Record<GoodType, number>>
	return stock
}

/**
 * Measure the tendencies for a single zone — **locally** over the zone's own tiles.
 * Demand (construction needs) and offer (stock) are summed from the zone's tiles;
 * no board-wide scan is needed (the ledger is only the board-scoped generalization).
 */
export function measureZoneTendencies(game: Game, zone: ZoneDefinition): ZoneTendencies {
	const coords = game.hex.zoneManager.coordsForZone(zone)

	const demand: Record<string, number> = {}
	const offer: Record<string, number> = {}
	const commerceNeed: Record<string, number> = {}
	let dwellings = 0
	let underConstruction = 0
	let shops = 0
	let freeSlots = 0
	for (const coord of coords) {
		const tile = game.hex.getTile(coord)
		const content = tile?.content

		// Construction demand declared by this tile (shell remaining needs, or a
		// foundation's material shortfall) — the same extraction the board ledger uses.
		if (isConstructionSiteShell(content)) {
			for (const [good, qty] of Object.entries(content.remainingNeeds)) {
				if ((qty ?? 0) > 0) demand[good] = (demand[good] ?? 0) + Number(qty)
			}
		} else if (
			content instanceof UnBuiltLand &&
			content.constructionSite &&
			content.foundationStorage
		) {
			for (const [good, qty] of Object.entries(
				materialRemainingNeeds(
					content.constructionSite.foundationRequiredGoods,
					content.foundationStorage
				)
			)) {
				if ((qty ?? 0) > 0) demand[good] = (demand[good] ?? 0) + Number(qty)
			}
		}

		if (content instanceof BasicDwelling) {
			dwellings += 1
			freeSlots += content.freeHomeSlots
		} else if (
			content instanceof BuildDwelling ||
			(content instanceof UnBuiltLand && content.site === 'residential:basic_dwelling')
		) {
			underConstruction += 1
		}
		if (content instanceof Shop) {
			shops += 1
			// A shop's restock need is its empty shelf: for each stocked good, the
			// shortfall between its capacity and current stock is the commerce it needs.
			for (const good of Object.keys(content.storage.maxAmounts) as GoodType[]) {
				const capacity = content.storage.maxAmounts[good] ?? 0
				const stock = content.storage.stock[good] ?? 0
				const need = Math.max(0, capacity - stock)
				if (need > 0) commerceNeed[good] = (commerceNeed[good] ?? 0) + need
			}
		}
		for (const [good, qty] of Object.entries(tileStock(game, coord))) {
			offer[good] = (offer[good] ?? 0) + Number(qty)
		}
	}

	const center = game.hex.zoneManager.centralCoordForZone(zone)
	const peopleNear = center ? countPeopleNear(game, center, residentialHousingDemandRadius) : 0
	const shoppers = center ? countPeopleNear(game, center, commercialShopSensingRadius) : 0

	return {
		demand: demand as Partial<Record<GoodType, number>>,
		commerceNeed: commerceNeed as Partial<Record<GoodType, number>>,
		offer: offer as Partial<Record<GoodType, number>>,
		dwellings,
		underConstruction,
		shops,
		housingPressure: Math.max(0, peopleNear - freeSlots),
		shoppers,
	}
}
