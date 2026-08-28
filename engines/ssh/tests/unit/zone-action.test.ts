// @ts-nocheck
import { Game } from 'ssh/game/game'
import { afterEach, describe, expect, it } from 'vitest'

describe('applyZoneAction (typed zone tools)', () => {
	let game: Game

	afterEach(() => {
		game?.destroy()
	})

	it('paints residential/harvest/commercial as typed zones, not passive named zones', async () => {
		game = new Game({ terrainSeed: 7, characterCount: 0 })
		await game.loaded
		game.ticker.stop()

		const tileA = game.hex.getTile({ q: 0, r: 0 })!
		const tileB = game.hex.getTile({ q: 1, r: 0 })!

		// Painting "residential" must create/assign a zone whose `type` is
		// `residential` (the residential spawner + tile border colour key off `type`).
		expect(game.applyZoneAction(tileA, 'residential')).toBe(true)
		expect(tileA.zone?.type).toBe('residential')
		// A second paint with the same tool reuses the same residential definition.
		expect(game.applyZoneAction(tileB, 'residential')).toBe(true)
		expect(tileB.zone).toBe(tileA.zone)

		// `none` clears the tile's zone.
		expect(game.applyZoneAction(tileA, 'none')).toBe(true)
		expect(tileA.zone).toBeUndefined()
		expect(tileB.zone?.type).toBe('residential')

		// A named custom zone still resolves by name and stays a passive, named zone.
		const custom = game.hex.zoneManager.defineZone({
			name: 'My Zone',
			type: 'passive',
			color: '#ff0000',
		})
		expect(game.applyZoneAction(tileA, 'My Zone')).toBe(true)
		expect(tileA.zone).toBe(custom)
	})

	it('reuses an existing typed zone instead of minting a new one', async () => {
		game = new Game({ terrainSeed: 7, characterCount: 0 })
		await game.loaded
		game.ticker.stop()

		const existing = game.hex.zoneManager.defineZone({ type: 'harvest' })
		const tile = game.hex.getTile({ q: 0, r: 0 })!

		game.applyZoneAction(tile, 'harvest')

		expect(tile.zone).toBe(existing)
		expect(
			game.hex.zoneManager.listZoneDefinitions().filter((z) => z.type === 'harvest')
		).toHaveLength(1)
	})
})
