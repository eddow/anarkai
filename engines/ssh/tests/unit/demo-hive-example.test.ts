import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { demoHive } from 'ssh/game/exampleGames'
import { Game } from 'ssh/game/game'
import { afterEach, describe, expect, it } from 'vitest'

describe('demoHive example game', () => {
	let game: Game | undefined

	afterEach(() => {
		game?.destroy()
		game = undefined
	})

	it('loads a narrative demo hive with housing, forestry, freight, and trade hooks', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, demoHive)
		await game.loaded
		game.ticker.stop()

		expect(game.hex.getTile({ q: 0, r: 0 })?.content?.name).toBe('storage')
		expect(game.hex.getTile({ q: 0, r: 1 })?.content?.name).toBe('freight_bay')
		expect(game.hex.getTile({ q: 1, r: -1 })?.content?.name).toBe('engineer')
		expect(game.hex.getTile({ q: 1, r: 0 })?.content?.name).toBe('sawmill')
		expect(game.hex.getTile({ q: 2, r: 0 })?.content?.name).toBe('tree_chopper')
		expect(game.hex.getTile({ q: 2, r: -1 })?.content?.name).toBe('forester')

		expect(game.hex.zoneManager.getZone({ q: 3, r: -1 })).toBe('green-ring')
		expect(game.hex.zoneManager.getZone({ q: -4, r: 1 })).toBe('residential')
		expect(game.hex.zoneManager.getZone({ q: -5, r: 1 })).toBe('commercial')
		expect(game.hex.getTile({ q: -4, r: 1 })?.content).toBeInstanceOf(BasicDwelling)
		expect(game.hex.getTile({ q: -3, r: 1 })?.content).toBeInstanceOf(BuildDwelling)

		expect(game.freightLines.map((line) => line.id)).toEqual(
			expect.arrayContaining([
				'HearthLoop:commons-exchange',
				'HearthLoop:melindbury-comfort-loop',
			])
		)
		expect(game.vehicles.vehicle('HearthLoop:wheelbarrow')?.servedLines.map((line) => line.id)).toEqual([
			'HearthLoop:commons-exchange',
		])
		expect(
			game.vehicles.vehicle('HearthLoop:pickup-truck')?.servedLines.map((line) => line.id)
		).toEqual(['HearthLoop:melindbury-comfort-loop'])

		const melindbury = game.getSettlementTradeProfile('settlement-7,19')
		expect(melindbury?.name).toBe('Melindbury')
		expect(melindbury?.offers).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ good: 'concrete', direction: 'sell' }),
				expect.objectContaining({ good: 'planks', direction: 'buy' }),
			])
		)

		expect(game.hex.getRoadType({ q: -0.5, r: 1 })).toBe('path')
		expect(game.hex.getRoadType({ q: -3.5, r: 1 })).toBe('path')
	})
})
