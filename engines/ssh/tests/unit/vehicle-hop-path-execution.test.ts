import { chopSaw } from 'ssh/game/exampleGames'
import { Game } from 'ssh/game/game'
import { afterEach, describe, expect, it } from 'vitest'

describe('vehicleHop execution paths', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('preserves the vehicle route path when the operator is already onboard', async () => {
		game = new Game({ terrainSeed: 9426, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:materials-loop:0,0:Melindbury'
		)
		const bayStop = line?.stops.find((stop) => stop.id === 'ChopSaw:materials-bay')
		const pickup = game.vehicles.vehicle('ChopSaw:suv')
		if (!line || !bayStop || !pickup) throw new Error('expected ChopSaw materials fixture')

		const character = game.population.createCharacter('Cresen', { q: -6, r: 2 })
		character.position = { q: -5.5, r: 1.5 }
		pickup.position = { q: -5.5, r: 1.5 }
		pickup.beginLineService(line, bayStop, character)
		character.operates = pickup
		character.onboard()
		void character.scriptsContext

		const match = character.resolveBestJobMatch()
		if (!match || match.job.job !== 'vehicleHop') throw new Error('expected vehicleHop')
		expect(match.job.path.length).toBeGreaterThan(0)
		expect(match.path).toHaveLength(0)

		const execution = character.findBestJob()
		if (!execution) throw new Error('expected executable vehicleHop')
		expect(() => execution.run(character.scriptsContext)).not.toThrow()
		expect(pickup.isDocked).toBe(false)
		expect(pickup.position).toMatchObject({ q: -5.5, r: 1.5 })
	})
})
