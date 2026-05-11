import { chopSaw } from 'ssh/game/exampleGames'
import { Game } from 'ssh/game/game'
import { afterEach, describe, expect, it } from 'vitest'

describe('chopSaw example game', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('serves both gather and distribute freight lines from the freight bay', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const lineIds = game.freightLines.map((line) => line.id)
		expect(lineIds).toEqual(
			expect.arrayContaining([
				'ChopSaw:implicit-gather:11,-7',
				'ChopSaw:distribute:11,-7',
			])
		)

		const distribute = game.freightLines.find(
			(line) => line.id === 'ChopSaw:distribute:11,-7'
		)
		expect(distribute?.stops[0]).toMatchObject({
			id: 'ChopSaw:distribute-load',
			anchor: {
				kind: 'alveolus',
				hiveName: 'ChopSaw',
				alveolusType: 'freight_bay',
				coord: [11, -7],
			},
		})
		expect(distribute?.stops[1]).toMatchObject({
			id: 'ChopSaw:distribute-zone',
			zone: { kind: 'radius', center: [11, -7], radius: 9 },
		})

		const vehicle = game.vehicles.vehicle('ChopSaw:wheelbarrow')
		expect(vehicle?.servedLines.map((line) => line.id)).toEqual(
			expect.arrayContaining([
				'ChopSaw:implicit-gather:11,-7',
				'ChopSaw:distribute:11,-7',
			])
		)
	})
})
