import { Shop, shopStockGoods } from 'ssh/commerce/shop'
import { Game } from 'ssh/game/game'
import { SpecificStorage } from 'ssh/storage/specific-storage'
import { afterEach, describe, expect, it } from 'vitest'

describe('Shop', () => {
	let game: Game | undefined

	afterEach(() => {
		game?.destroy()
	})

	it('resolves stock goods from a shop type by tag', () => {
		// `food` and `personal-goods` tags exist in both the real and mock goods catalogs.
		expect(shopStockGoods('grocery')).toContain('bread')
		expect(shopStockGoods('clothing')).toContain('clothes')
	})

	it('places a shop that is a non-feeding estate with a shelf', async () => {
		game = new Game(
			{ terrainSeed: 1, characterCount: 0, settlementGeneration: false },
			{
				terrains: { grass: [[0, 0]] },
				shops: [{ coord: [0, 0], shopType: 'grocery', goods: { bread: 3 } }],
			}
		)
		await game.loaded
		game.ticker.stop()

		const content = game.hex.getTile({ q: 0, r: 0 })?.content
		expect(content).toBeInstanceOf(Shop)
		if (!(content instanceof Shop)) return

		// Estate: commercial → does not feed the price field.
		expect(content.feedsPriceField).toBe(false)
		expect(content.footprint).toHaveLength(1)
		expect(content.footprint[0]).toMatchObject({ q: 0, r: 0 })
		expect(content.storage).toBeInstanceOf(SpecificStorage)
		expect(content.storage.stock.bread).toBe(3)

		// profile mirrors the shelf (stock + capacity from the shelf storage).
		expect(content.profile.bread?.stock).toBe(3)
		expect(content.profile.bread?.capacity).toBeGreaterThan(0)
		expect(content.profile.bread?.normalizedDelta).toBe(0)
	})
})
