import { goods as goodsCatalog, type ShopType, shops } from 'engine-rules'
import { reactive } from 'mutts'
import { gameIsaTypes } from 'ssh/npcs/utils'
import { SpecificStorage } from 'ssh/storage/specific-storage'
import type { GoodType } from 'ssh/types/base'
import type { AxialCoord } from 'ssh/utils/axial'
import { axial } from 'ssh/utils/axial'
import { toAxialCoord } from 'ssh/utils/position'
import { TileContent } from '../board/content/content'
import type { Tile } from '../board/tile'
import type { Estate, EstateCommerceProfile } from './commerce-model'

/** Tag prefix-match, mirroring `GoodSelectionPolicy` (`tag` matches `tag` and `tag/*`). */
function tagMatches(rule: string, tag: string): boolean {
	return tag === rule || tag.startsWith(`${rule}/`)
}

/**
 * The concrete goods a shop type stocks, resolved from its `stockTags` against the
 * goods catalog. An empty `stockTags` (the `general` shop) stocks every good.
 */
export function shopStockGoods(shopType: ShopType): GoodType[] {
	const def = shops[shopType]
	return (Object.keys(goodsCatalog) as GoodType[]).filter(
		(good) =>
			def.stockTags.length === 0 ||
			goodsCatalog[good].tags.some((tag) => def.stockTags.some((rule) => tagMatches(rule, tag)))
	)
}

/**
 * A shop — the money-facing commercial estate.
 *
 * A shop is **not** an alveolus and **not** a hive: it is a non-alveolus
 * `TileContent` (like `BasicDwelling`) implementing the `Estate` interface. It
 * holds a shelf (`SpecificStorage`) and is the only boundary through which outside
 * carriers transact; `feedsPriceField = false` (commercial estates consume but do
 * not feed the price field). It can expand over several tiles via growth/merging —
 * the `footprint` is a single tile for now, with multi-tile growth to come.
 *
 * Staffing (one character per tile) and walkability (enterable-not-traversable)
 * are deferred — see `plans/spontaneous-zones.md`.
 */
@reactive
export class Shop extends TileContent implements Estate {
	readonly shopType: ShopType
	readonly footprint: readonly AxialCoord[]
	readonly storage: SpecificStorage

	constructor(
		public readonly tile: Tile,
		shopType: ShopType
	) {
		const coord = toAxialCoord(tile.position)!
		super(tile.board.game, `shop:${shopType}:${coord.q},${coord.r}`)
		this.shopType = shopType
		this.footprint = [coord]
		const maxAmounts = {} as Record<GoodType, number>
		for (const good of shopStockGoods(shopType)) {
			maxAmounts[good] = shops[shopType].capacityBase
		}
		this.storage = new SpecificStorage(maxAmounts)
		this.storage.setPresentationChangeNotifier(() =>
			this.game.enqueueStoragePresentationChange(this.tile)
		)
	}

	override get name(): string {
		return 'shop'
	}

	get titleKey(): string {
		return `shop.${this.shopType}`
	}

	get debugInfo() {
		return {
			type: 'Shop',
			shopType: this.shopType,
			stock: this.storage.stock,
		}
	}

	get walkTime(): number {
		return 1
	}

	get background(): string {
		return 'buildings.shop'
	}

	canInteract(_action: string): boolean {
		return false
	}

	// ── Estate ─────────────────────────────────────────────────────────────

	/**
	 * The shop's shelf, read as an estate profile: `normalizedDelta = 0` (a shop is
	 * a consumer/boundary, not a producer — it does not feed the price field), with
	 * `stock`/`capacity` from its shelf storage. The `capacityBase` is the 1-tile
	 * triangular-curve base; multi-tile growth scales it later.
	 */
	get profile(): EstateCommerceProfile {
		const profile: EstateCommerceProfile = {}
		for (const good of Object.keys(this.storage.maxAmounts) as GoodType[]) {
			profile[good] = {
				normalizedDelta: 0,
				stock: this.storage.stock[good] ?? 0,
				capacity: this.storage.maxAmounts[good] ?? 0,
			}
		}
		return profile
	}

	get feedsPriceField(): boolean {
		return false
	}

	distanceTo(other: Estate): number {
		let min = Number.POSITIVE_INFINITY
		for (const a of this.footprint) {
			for (const b of other.footprint) {
				const d = axial.distance(a, b)
				if (d < min) min = d
			}
		}
		return Number.isFinite(min) ? min : 0
	}
}

gameIsaTypes.shop = (value: unknown) => value instanceof Shop
