import { findVehicleApproachJob } from 'ssh/freight/vehicle-work'
import { Game } from 'ssh/game/game'
import { axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import { afterEach, describe, expect, it } from 'vitest'
import { gatherFreightLine } from '../freight-fixtures'

describe('findVehicleApproachJob', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('returns a punctual path whose last hex is the vehicle tile (not an adjacent stop)', async () => {
		const line = gatherFreightLine({
			id: 'VA:job',
			name: 'Approach job',
			hiveName: 'H',
			coord: [1, 0],
			filters: ['wood'],
			radius: 3,
		})
		game = new Game(
			{ terrainSeed: 9400, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0] as const, terrain: 'grass' as const },
					{ coord: [1, 0] as const, terrain: 'grass' as const },
				],
				freightLines: [line],
			}
		)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('v-approach', 'wheelbarrow', { q: 1, r: 0 }, [line])
		const character = game.population.createCharacter('Eve', { q: 0, r: 0 })

		const job = findVehicleApproachJob(game, character)
		expect(job).toBeDefined()
		expect(job!.vehicleUid).toBe(vehicle.uid)
		const goal = axial.round(toAxialCoord(vehicle.position))
		const last = job!.path[job!.path.length - 1]!
		expect(axial.key(last)).toBe(axial.key(goal))
	})
})
