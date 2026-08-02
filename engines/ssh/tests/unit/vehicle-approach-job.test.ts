// @ts-nocheck
import { maybeAdvanceVehiclePastCompletedZoneStop } from 'ssh/freight/vehicle-run'
import { findVehicleApproachJob, findVehicleHopJob } from 'ssh/freight/vehicle-work'
import { Game } from 'ssh/game/game'
import { isVehicleLineService } from 'ssh/population/vehicle/vehicle'
import type { WorkPlan } from 'ssh/types/base'
import { axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import { afterEach, describe, expect, it } from 'vitest'
import { gatherFreightLine } from '../freight-fixtures'
import { debugObjectId } from 'ssh/dev/debug-object-id'

describe('findVehicleApproachJob', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('returns a punctual path whose last hex is the vehicle tile (not an adjacent stop)', async () => {
		const line = gatherFreightLine({
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
					{ coord: [2, 0] as const, terrain: 'grass' as const },
				],
				hives: [
					{
						name: 'H',
						alveoli: [
							{ coord: [1, 0] as const, alveolus: 'freight_bay' as const, goods: {} },
							// Transform demand gives unload sink room so zone-load begin-service is actionable.
							{ coord: [2, 0] as const, alveolus: 'sawmill' as const, goods: {} },
						],
					},
				],
				freightLines: [line],
				looseGoods: { wood: [[0, 0]] },
			}
		)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('wheelbarrow', { q: 1, r: 0 }, [line])
		const character = game.population.createCharacter('Eve', { q: 0, r: 0 })

		const job = findVehicleApproachJob(game, character)
		expect(job).toBeDefined()
		expect(job!.vehicle).toBe(vehicle)
		const goal = axial.round(toAxialCoord(vehicle.effectivePosition))
		const last = job!.path[job!.path.length - 1]!
		expect(axial.key(last)).toBe(axial.key(goal))
	})

	it('normalizes same-tile approach to an empty path', async () => {
		const line = gatherFreightLine({
			name: 'Same tile',
			hiveName: 'H',
			coord: [0, 0],
			filters: ['wood'],
			radius: 2,
		})
		game = new Game(
			{ terrainSeed: 9401, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0] as const, terrain: 'grass' as const },
					{ coord: [1, 0] as const, terrain: 'grass' as const },
					{ coord: [0, 1] as const, terrain: 'grass' as const },
				],
				hives: [
					{
						name: 'H',
						alveoli: [
							{ coord: [0, 0] as const, alveolus: 'freight_bay' as const, goods: {} },
							{ coord: [1, 0] as const, alveolus: 'sawmill' as const, goods: {} },
						],
					},
				],
				freightLines: [line],
				// Loose wood on a free tile inside radius (not under the sawmill).
				looseGoods: { wood: [[0, 1]] },
			}
		)
		await game.loaded
		game.ticker.stop()

		game.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('Eve', { q: 0, r: 0 })

		const job = findVehicleApproachJob(game, character)
		expect(job).toBeDefined()
		expect(job?.path).toEqual([])
	})

	it('re-approach keeps an existing active line service instead of re-picking an initial line', async () => {
		const far = gatherFreightLine({
			name: 'Far',
			hiveName: 'H',
			coord: [8, 0],
			filters: ['wood'],
			radius: 2,
		})
		const near = gatherFreightLine({
			name: 'Near',
			hiveName: 'H',
			coord: [0, 0],
			filters: ['wood'],
			radius: 2,
		})
		const corridor = Array.from({ length: 9 }, (_, q) => ({
			coord: [q, 0] as const,
			terrain: 'grass' as const,
		}))
		game = new Game(
			{ terrainSeed: 9402, characterCount: 0 },
			{
				tiles: corridor,
				hives: [
					{
						name: 'H',
						alveoli: [
							{ coord: [0, 0] as const, alveolus: 'freight_bay' as const, goods: {} },
							{ coord: [8, 0] as const, alveolus: 'freight_bay' as const, goods: {} },
							{ coord: [1, 0] as const, alveolus: 'sawmill' as const, goods: {} },
						],
					},
				],
				freightLines: [far, near],
			}
		)
		await game.loaded
		game.ticker.stop()

		const farLine = game.freightLines.find((l) => l.name === 'Far')!
		const nearLine = game.freightLines.find((l) => l.name === 'Near')!
		expect(farLine).toBeDefined()
		expect(nearLine).toBeDefined()

		const vehicle = game.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 }, [
			farLine,
			nearLine,
		])
		// Active service already on far unload anchor — re-approach must keep that line.
		vehicle.beginLineService(farLine, farLine.stops[1]!)
		expect(isVehicleLineService(vehicle.service)).toBe(true)
		vehicle.releaseOperator()

		const character = game.population.createCharacter('Eve', { q: 1, r: 0 })

		const job = findVehicleHopJob(game, character)
		expect(job?.job).toBe('vehicleHop')
		expect(job?.approachPath).toBeDefined()
		expect(job?.needsBeginService).toBeUndefined()
		// Keep Far (active service), not Near — compare by name because hop planning may
		// surface a normalized line object rather than the exact servedLines reference.
		expect(job?.line?.name).toBe('Far')
		expect(job?.line?.name).not.toBe('Near')
		expect(job?.stopIndex).toBe(1)
	})

	it('planner snapshot counts only approach distance for vehicleHop work selection', async () => {
		const line = gatherFreightLine({
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
					{ coord: [2, 0] as const, terrain: 'grass' as const },
				],
				hives: [
					{
						name: 'H',
						alveoli: [
							{ coord: [1, 0] as const, alveolus: 'freight_bay' as const, goods: {} },
							{ coord: [2, 0] as const, alveolus: 'sawmill' as const, goods: {} },
						],
					},
				],
				freightLines: [line],
				looseGoods: { wood: [[0, 0]] },
			}
		)
		await game.loaded
		game.ticker.stop()

		game.vehicles.createVehicle('wheelbarrow', { q: 1, r: 0 }, [line])
		const character = game.population.createCharacter('Eve', { q: 0, r: 0 })

		const hopJob = findVehicleHopJob(game, character)
		expect(hopJob?.job).toBe('vehicleHop')

		const hop = character.workPlannerSnapshot?.ranked.find((row) => row.jobKind === 'vehicleHop')
		expect(hop).toBeDefined()
		expect(hop?.pathLength).toBe(hopJob?.approachPath?.length ?? 0)
	})

	it('does not re-approach a still-docked anchor service before dock completion', async () => {
		const line = gatherFreightLine({
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

		const vehicle = game.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 }, [line])
		vehicle.beginLineService(line, line.stops[1]!)
		vehicle.dock()
		vehicle.releaseOperator()

		const character = game.population.createCharacter('Eve', { q: 1, r: 0 })

		expect(findVehicleApproachJob(game, character)).toBeUndefined()
		expect(findVehicleHopJob(game, character)).toBeUndefined()
	})

	it('advances an empty completed gather zone service to the unload stop (same as vehicleHopPrepare replan)', async () => {
		const line = gatherFreightLine({
			name: 'Empty gather',
			hiveName: 'H',
			coord: [0, 0],
			filters: ['wood'],
			radius: 2,
		})
		game = new Game(
			{ terrainSeed: 9405, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0] as const, terrain: 'grass' as const },
					{ coord: [1, 0] as const, terrain: 'grass' as const },
				],
				hives: [
					{
						name: 'H',
						alveoli: [{ coord: [0, 0] as const, alveolus: 'freight_bay' as const, goods: {} }],
					},
				],
				freightLines: [line],
			}
		)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('Eve', { q: 0, r: 0 })
		vehicle.beginLineService(line, line.stops[0]!, character)
		character.operates = vehicle
		character.onboard()

		maybeAdvanceVehiclePastCompletedZoneStop(game, vehicle, character)

		expect(isVehicleLineService(vehicle.service)).toBe(true)
		if (!isVehicleLineService(vehicle.service)) throw new Error('expected line service')
		// Compare against the service line's own stop list (fixture line may be a distinct object
		// after bootstrap normalize / vehicle servedLines copy).
		expect(vehicle.service.line.stops.indexOf(vehicle.service.stop)).toBe(1)
		expect(vehicle.service.stop).toEqual(vehicle.service.line.stops[1])
		expect(character.operates).toBe(vehicle)
	})

	it('aborts a stale approach when another worker operates the vehicle', async () => {
		const line = gatherFreightLine({
			name: 'Stale approach',
			hiveName: 'H',
			coord: [0, 0],
			filters: ['wood'],
			radius: 2,
		})
		game = new Game(
			{ terrainSeed: 9406, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0] as const, terrain: 'grass' as const },
					{ coord: [1, 0] as const, terrain: 'grass' as const },
				],
				hives: [
					{
						name: 'H',
						alveoli: [{ coord: [0, 0] as const, alveolus: 'freight_bay' as const, goods: {} }],
					},
				],
				freightLines: [line],
				looseGoods: { wood: [[1, 0]] },
			}
		)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 }, [line])
		const operator = game.population.createCharacter('Op', { q: 0, r: 0 })
		const stale = game.population.createCharacter('Stale', { q: 1, r: 0 })
		vehicle.beginLineService(line, line.stops[0]!, operator)
		operator.operates = vehicle
		const plan: WorkPlan = {
			type: 'work',
			job: 'vehicleHop',
			target: vehicle,
			urgency: 1,
			fatigue: 1,
			vehicle,
			line: line,
			stopIndex: 0,
			path: [],
			dockEnter: false,
			approachPath: [{ q: 0, r: 0 }],
		}

		stale.scriptsContext.vehicle.vehicleApproachStep(plan)

		expect(plan.vehicleApproachAborted).toBe(true)
		expect(vehicle.operator).toBe(operator)
		expect(stale.operates).toBeUndefined()
	})
})
