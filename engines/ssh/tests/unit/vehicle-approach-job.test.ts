import { findVehicleApproachJob, findVehicleHopJob } from 'ssh/freight/vehicle-work'
import { Game } from 'ssh/game/game'
import { isVehicleLineService } from 'ssh/population/vehicle/vehicle'
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

	it('normalizes same-tile approach to an empty path', async () => {
		const line = gatherFreightLine({
			id: 'VA:same-tile',
			name: 'Same tile',
			hiveName: 'H',
			coord: [0, 0],
			filters: ['wood'],
			radius: 2,
		})
		game = new Game(
			{ terrainSeed: 9401, characterCount: 0 },
			{
				tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
				freightLines: [line],
			}
		)
		await game.loaded
		game.ticker.stop()

		game.vehicles.createVehicle('v-same', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('Eve', { q: 0, r: 0 })

		const job = findVehicleApproachJob(game, character)
		expect(job).toBeDefined()
		expect(job?.path).toEqual([])
	})

	it('re-approach keeps an existing active line service instead of re-picking an initial line', async () => {
		const far = gatherFreightLine({
			id: 'VA:far',
			name: 'Far',
			hiveName: 'H',
			coord: [8, 0],
			filters: ['wood'],
			radius: 2,
		})
		const near = gatherFreightLine({
			id: 'VA:near',
			name: 'Near',
			hiveName: 'H',
			coord: [0, 0],
			filters: ['wood'],
			radius: 2,
		})
		game = new Game(
			{ terrainSeed: 9402, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0] as const, terrain: 'grass' as const },
					{ coord: [1, 0] as const, terrain: 'grass' as const },
					{ coord: [8, 0] as const, terrain: 'grass' as const },
				],
				freightLines: [far, near],
			}
		)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('v-service', 'wheelbarrow', { q: 0, r: 0 }, [
			far,
			near,
		])
		vehicle.beginLineService(far, far.stops[1]!)
		expect(isVehicleLineService(vehicle.service)).toBe(true)
		vehicle.releaseOperator()

		const character = game.population.createCharacter('Eve', { q: 1, r: 0 })

		const job = findVehicleHopJob(game, character)
		expect(job?.job).toBe('vehicleHop')
		expect(job?.approachPath).toBeDefined()
		expect(job?.needsBeginService).toBeUndefined()
		expect(job?.lineId).toBe(far.id)
		expect(job?.stopId).toBe(far.stops[1]!.id)
	})

	it('planner snapshot counts vehicle approach distance in vehicleHop path length', async () => {
		const line = gatherFreightLine({
			id: 'VA:snapshot',
			name: 'Snapshot',
			hiveName: 'H',
			coord: [1, 0],
			filters: ['wood'],
			radius: 2,
		})
		game = new Game(
			{ terrainSeed: 9404, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0] as const, terrain: 'grass' as const },
					{ coord: [1, 0] as const, terrain: 'grass' as const },
				],
				freightLines: [line],
				looseGoods: [{ goodType: 'wood' as const, position: { q: 0, r: 0 } }],
			}
		)
		await game.loaded
		game.ticker.stop()

		game.vehicles.createVehicle('v-snapshot', 'wheelbarrow', { q: 1, r: 0 }, [line])
		const character = game.population.createCharacter('Eve', { q: 0, r: 0 })

		const hopJob = findVehicleHopJob(game, character)
		expect(hopJob?.job).toBe('vehicleHop')

		const hop = character.workPlannerSnapshot?.ranked.find((row) => row.jobKind === 'vehicleHop')
		expect(hop).toBeDefined()
		expect(hop?.pathLength).toBe((hopJob?.path.length ?? 0) + (hopJob?.approachPath?.length ?? 0))
	})

	it('does not re-approach a still-docked anchor service before dock completion', async () => {
		const line = gatherFreightLine({
			id: 'VA:docked',
			name: 'Docked',
			hiveName: 'H',
			coord: [0, 0],
			filters: ['wood'],
			radius: 2,
		})
		game = new Game(
			{ terrainSeed: 9403, characterCount: 0 },
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

		const vehicle = game.vehicles.createVehicle('v-docked', 'wheelbarrow', { q: 0, r: 0 }, [line])
		vehicle.beginLineService(line, line.stops[1]!)
		vehicle.dock()
		vehicle.releaseOperator()

		const character = game.population.createCharacter('Eve', { q: 1, r: 0 })

		expect(findVehicleApproachJob(game, character)).toBeUndefined()
		expect(findVehicleHopJob(game, character)).toBeUndefined()
	})
})
