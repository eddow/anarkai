import { measureZoneTendencies } from 'ssh/commerce/zone-tendencies'
import { Game } from 'ssh/game/game'
import { afterEach, describe, expect, it } from 'vitest'

describe('measureZoneTendencies', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('aggregates per-good demand and offer plus structural counts for a zone', async () => {
		game = new Game(
			{ terrainSeed: 3100, characterCount: 0, settlementGeneration: false },
			{
				tiles: [
					{ coord: [0, 0], terrain: 'grass' },
					{ coord: [0, 1], terrain: 'grass' },
				],
				zones: [{ type: 'residential', coords: [[0, 0]] }],
				// A dwelling shell needing wood + planks inside the zone.
				dwellings: [
					{
						coord: [0, 0],
						tier: 'basic_dwelling',
						underConstruction: true,
						constructionPhase: 'waiting_materials',
					},
				],
				// A grocery shop outside the zone holding bread — must NOT leak into demand/offer.
				shops: [{ coord: [0, 1], shopType: 'grocery', goods: { bread: 3 } }],
			}
		)
		await game.loaded
		game.ticker.stop()

		const zone = game.hex.getTile({ q: 0, r: 0 })!.zone!
		const t = measureZoneTendencies(game, zone)

		expect(t.demand.wood).toBeGreaterThan(0)
		expect(t.demand.planks).toBeGreaterThan(0)
		// The shop is outside the zone → its bread stock is not folded in.
		expect(t.offer.bread).toBeUndefined()
		expect(t.underConstruction).toBe(1)
		expect(t.dwellings).toBe(0)
		expect(t.shops).toBe(0)
	})

	it('counts shops, dwellings and their stock offer inside the zone', async () => {
		game = new Game(
			{ terrainSeed: 3101, characterCount: 0, settlementGeneration: false },
			{
				tiles: [
					{ coord: [0, 0], terrain: 'grass' },
					{ coord: [1, 0], terrain: 'grass' },
				],
				zones: [{ type: 'commercial', coords: [[0, 0]] }],
				shops: [{ coord: [0, 0], shopType: 'grocery', goods: { bread: 4 } }],
				dwellings: [{ coord: [1, 0], tier: 'basic_dwelling' }],
			}
		)
		await game.loaded
		game.ticker.stop()

		const zone = game.hex.getTile({ q: 0, r: 0 })!.zone!
		const t = measureZoneTendencies(game, zone)

		expect(t.shops).toBe(1)
		expect(t.offer.bread).toBe(4)
		// Empty-shelf restock need: grocery capacity 12 − 4 stocked = 8 needed.
		expect(t.commerceNeed.bread).toBe(8)
		// Dwelling at (1,0) is outside the commercial zone.
		expect(t.dwellings).toBe(0)
	})

	it('reports no commerce need when a shop shelf is full', async () => {
		game = new Game(
			{ terrainSeed: 3103, characterCount: 0, settlementGeneration: false },
			{
				tiles: [{ coord: [0, 0], terrain: 'grass' }],
				zones: [{ type: 'commercial', coords: [[0, 0]] }],
				// Full grocery shelf (capacity 12) → no restock shortfall.
				shops: [{ coord: [0, 0], shopType: 'grocery', goods: { bread: 12 } }],
			}
		)
		await game.loaded
		game.ticker.stop()

		const zone = game.hex.getTile({ q: 0, r: 0 })!.zone!
		const t = measureZoneTendencies(game, zone)

		expect(t.commerceNeed.bread).toBeUndefined()
	})

	it('reports housing pressure from nearby people minus free slots', async () => {
		game = new Game(
			{ terrainSeed: 3102, characterCount: 0, settlementGeneration: false },
			{
				tiles: [
					{ coord: [0, 0], terrain: 'grass' },
					{ coord: [1, 0], terrain: 'grass' },
				],
				zones: [{ type: 'residential', coords: [[0, 0]] }],
				dwellings: [{ coord: [0, 0], tier: 'basic_dwelling' }],
			}
		)
		await game.loaded
		game.ticker.stop()

		game.population.createCharacter('A', { q: 1, r: 0 })
		game.population.createCharacter('B', { q: 2, r: 0 })

		const zone = game.hex.getTile({ q: 0, r: 0 })!.zone!
		const t = measureZoneTendencies(game, zone)

		// Two people near, one reserved-free dwelling (1 free slot) → pressure 1.
		expect(t.dwellings).toBe(1)
		expect(t.housingPressure).toBeGreaterThan(0)
	})
})
