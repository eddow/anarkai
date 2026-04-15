import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { Game } from 'ssh/game/game'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('residential dwelling visuals', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	beforeEach(async () => {
		game = new Game(
			{ terrainSeed: 92, characterCount: 0 },
			{
				tiles: [{ coord: [0, 0], terrain: 'grass' }],
				zones: { residential: [[0, 0]] },
			}
		)
		await game.loaded
		game.ticker.stop()
	})

	it('paints BuildDwelling with the residential zoning color, not the project-placement pink', () => {
		const tile = game.hex.getTile({ q: 0, r: 0 })!
		const site = new BuildDwelling(tile, 'basic_dwelling')
		expect(site.colorCode()).toEqual({ tint: 0xaaffaa, borderColor: 0x44dd44 })
	})

	it('uses the cabin sprite key for completed basic dwellings', () => {
		const tile = game.hex.getTile({ q: 0, r: 0 })!
		tile.content = new BasicDwelling(tile)
		expect(tile.content.background).toBe('buildings.cabin')
	})
})
