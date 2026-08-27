import { commercialDefaultShopType, trySpawnCommercialShop } from 'ssh/commerce/commercial-demand'
import { Shop } from 'ssh/commerce/shop'
import { Game } from 'ssh/game/game'
import { afterEach, describe, expect, it } from 'vitest'

function shopAt(game: Game, q: number, r: number): Shop | undefined {
	const content = game.hex.getTile({ q, r })?.content
	return content instanceof Shop ? content : undefined
}

describe('trySpawnCommercialShop', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('spawns a grocery shop on a road-adjacent commercial tile after sustained pressure', async () => {
		game = new Game(
			{ terrainSeed: 2001, characterCount: 0, settlementGeneration: false },
			{
				tiles: [
					{ coord: [0, 0], terrain: 'grass' },
					{ coord: [0, 1], terrain: 'grass' },
					{ coord: [2, 0], terrain: 'grass' },
					{ coord: [1, 1], terrain: 'grass' },
				],
				zones: [
					{
						type: 'commercial',
						coords: [
							[0, 0],
							[0, 1],
							[2, 0],
						],
					},
				],
				// Road on the border between (0,0) and (0,1) → both are road-adjacent;
				// (2,0) has no road and must stay empty.
				roads: { path: [[0, 0.5]] },
			}
		)
		await game.loaded
		game.ticker.stop()

		game.population.createCharacter('Shopper', { q: 1, r: 1 })

		const observations = new Map<string, number>()
		// Below threshold: a transient pass must not commit.
		expect(trySpawnCommercialShop(game, observations)).toBe(false)
		expect(trySpawnCommercialShop(game, observations)).toBe(false)

		// Third sustained pass crosses the threshold → one shop spawns.
		expect(trySpawnCommercialShop(game, observations)).toBe(true)

		// Deterministic tie-break: equal shoppers → lowest coord key (0,0) wins.
		expect(shopAt(game, 0, 0)?.shopType).toBe(commercialDefaultShopType)
		// (0,1) was also eligible but one-per-pass leaves it for the next pass.
		expect(shopAt(game, 0, 1)).toBeUndefined()
		// (2,0) is not road-adjacent → never a candidate.
		expect(shopAt(game, 2, 0)).toBeUndefined()
	})

	it('does not spawn without sustained pressure (transient shortage)', async () => {
		game = new Game(
			{ terrainSeed: 2002, characterCount: 0, settlementGeneration: false },
			{
				tiles: [{ coord: [0, 0], terrain: 'grass' }],
				zones: [{ type: 'commercial', coords: [[0, 0]] }],
				roads: { path: [[0, 0.5]] },
			}
		)
		await game.loaded
		game.ticker.stop()

		// No characters → no shoppers → evidence never accumulates.
		const observations = new Map<string, number>()
		for (let i = 0; i < 5; i++) {
			expect(trySpawnCommercialShop(game, observations)).toBe(false)
		}
		expect(shopAt(game, 0, 0)).toBeUndefined()
	})

	it('does not spawn on a commercial tile with no road adjacency', async () => {
		game = new Game(
			{ terrainSeed: 2003, characterCount: 0, settlementGeneration: false },
			{
				tiles: [{ coord: [0, 0], terrain: 'grass' }],
				zones: [{ type: 'commercial', coords: [[0, 0]] }],
				// No roads at all → no candidate tile.
			}
		)
		await game.loaded
		game.ticker.stop()

		game.population.createCharacter('Shopper', { q: 0, r: 0 })

		const observations = new Map<string, number>()
		for (let i = 0; i < 5; i++) {
			expect(trySpawnCommercialShop(game, observations)).toBe(false)
		}
		expect(shopAt(game, 0, 0)).toBeUndefined()
	})
})
