import { chopSaw } from 'ssh/game/exampleGames'
import { Game } from 'ssh/game/game'
import { afterEach, describe, expect, it } from 'vitest'

describe('chopSaw example game', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('serves a cyclic exchange freight line from the freight bay', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const lineIds = game.freightLines.map((line) => line.id)
		expect(lineIds).toEqual(expect.arrayContaining(['ChopSaw:implicit-gather:0,0']))
		expect(lineIds).not.toContain('ChopSaw:distribute:0,0')

		const exchange = game.freightLines.find((line) => line.id === 'ChopSaw:implicit-gather:0,0')
		expect(exchange?.cyclic).toBe(true)
		expect(exchange?.stops[0]).toMatchObject({
			id: 'ChopSaw:ig-unload',
			loadSelection: expect.any(Object),
			unloadSelection: expect.any(Object),
			anchor: {
				kind: 'alveolus',
				hiveName: 'ChopSaw',
				alveolusType: 'freight_bay',
				coord: [0, 0],
			},
		})
		expect(exchange?.stops[1]).toMatchObject({
			id: 'ChopSaw:ig-load',
			loadSelection: expect.any(Object),
			unloadSelection: expect.any(Object),
			zone: { kind: 'radius', center: [0, 0], radius: 9 },
		})

		const vehicle = game.vehicles.vehicle('ChopSaw:wheelbarrow')
		expect(vehicle?.servedLines.map((line) => line.id)).toEqual(['ChopSaw:implicit-gather:0,0'])

		expect(game.hex.getRoadType({ q: -2.5, r: 1 })).toBe('path')
		expect(game.hex.getRoadType({ q: -1.5, r: 1 })).toBe('path')
		expect(game.hex.getRoadType({ q: -0.5, r: 1 })).toBe('path')
		expect(game.hex.getRoadType({ q: 0.5, r: 1 })).toBe('path')
	})

	it('loads the starter hive and zones into the default district', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const members = game.getDistrict()?.members.map((coord) => `${coord.q},${coord.r}`) ?? []
		expect(members).toEqual(
			expect.arrayContaining([
				'-1,-1',
				'2,0',
				'0,-1',
				'0,0',
				'1,-1',
				'1,0',
				'4,1',
				'3,2',
				'3,3',
				'-4,2',
				'-5,2',
				'-4,1',
				'-4,0',
			])
		)
	})
})
