/**
 * Spontaneous shop content — the commercial side of the economy.
 *
 * A **shop** is the money-facing endpoint for external commerce: it stocks goods
 * (industrial inputs + consumption goods) and is the only boundary through which
 * outside carriers transact — never industrial hives directly
 * (see `plans/commerce-architecture.md` and `plans/spontaneous-zones.md`).
 *
 * Shops are **content-defined like alveoli**: the zone spawner selects among these
 * named types rather than an abstract "a shop". Each type identifies what it
 * stocks by **good tags** (reusing the `GoodSelectionPolicy` tag vocabulary), so
 * a new good added with the right tag automatically lands on the relevant shelves.
 */

/** One named shop type — the commercial counterpart of an alveolus definition. */
export interface ShopDefinition {
	/** UI label localization key (e.g. `shop.construction-materials`). */
	readonly label: string
	/**
	 * Sell-side: every good carrying any of these tags is stocked on the shelves.
	 * Tags are matched against `goods[good].tags` with the same prefix semantics as
	 * `GoodSelectionPolicy` (a rule tag matches `tag` and `tag/*`).
	 */
	readonly stockTags: readonly string[]
	/**
	 * Buy/refill-side: goods the shop procures to restock. Defaults to `stockTags`
	 * (a pure-retail shop buys exactly what it sells); override for shops that buy
	 * ingredients and sell prepared goods.
	 */
	readonly needTags?: readonly string[]
	/** Triangular-capacity base: `capacity(n tiles) = capacityBase × n(n+1)/2`. */
	readonly capacityBase: number
	/** Relative spawn weight (higher → the spawner prefers this type first). */
	readonly spawnWeight?: number
}

export const shops = {
	construction_materials: {
		label: 'shop.construction-materials',
		stockTags: ['raw', 'material'], // wood, stone (raw) + planks, concrete (material)
		capacityBase: 20,
		spawnWeight: 1,
	},
	food: {
		label: 'shop.food',
		stockTags: ['food'], // berries, mushrooms, wheat, flour, bread, sandwich
		capacityBase: 12,
		spawnWeight: 1.4, // highest-urgency need → spawn first
	},
	clothing: {
		label: 'shop.clothing',
		stockTags: ['personal-goods'], // clothes, sunglasses
		capacityBase: 8,
		spawnWeight: 0.7,
	},
	research: {
		label: 'shop.research',
		stockTags: ['research'], // charcoal
		capacityBase: 5,
		spawnWeight: 0.3,
	},
	general: {
		label: 'shop.general',
		stockTags: [], // catch-all: no tag filter → any good
		capacityBase: 6,
		spawnWeight: 0.4,
	},
} as const satisfies Readonly<Record<string, ShopDefinition>>

export type ShopType = keyof typeof shops

/** A shop's sell-side needs are, by default, exactly its sell-side goods. */
export function shopNeedTags(shop: ShopDefinition): readonly string[] {
	return shop.needTags ?? shop.stockTags
}
