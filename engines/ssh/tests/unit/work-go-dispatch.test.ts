import { Game } from 'ssh/game/game'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gatherFreightLine } from '../freight-fixtures'

describe('work.npcs dispatch', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('goWork resolves vehicleHop via vehicle[job] and starts execution', async () => {
		game = new Game(
			{ terrainSeed: 9501, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0] as const, terrain: 'grass' as const },
					{ coord: [1, 0] as const, terrain: 'grass' as const },
				],
				freightLines: [
					gatherFreightLine({
						id: 'dispatch:gather',
						name: 'Dispatch gather',
						hiveName: 'H',
						coord: [0, 0],
						filters: ['wood'],
						radius: 2,
					}),
				],
				looseGoods: [{ goodType: 'wood' as const, position: { q: 1, r: 0 } }],
			}
		)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('v-dispatch', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('Dispatch', { q: 0, r: 0 })
		void character.scriptsContext
		vi.spyOn(character.scriptsContext.find, 'pathToVehicle').mockReturnValue([{ q: 0, r: 0 }])

		const workPlan = {
			type: 'work' as const,
			job: 'vehicleHop' as const,
			target: vehicle,
			vehicleUid: vehicle.uid,
			lineId: line.id,
			stopId: line.stops[0]!.id,
			urgency: 1,
			fatigue: 0,
			path: [],
			dockEnter: false,
			approachPath: [{ q: 0, r: 0 }],
			needsBeginService: true,
		}

		const execution = character.scriptsContext.work.goWork(workPlan)
		const first = execution.run(character.scriptsContext)
		expect(first.type === 'yield' || first.type === 'return').toBe(true)
		expect(vehicle.operator?.uid).toBe(character.uid)
		expect(character.operates?.uid).toBe(vehicle.uid)
		expect(character.driving).toBe(false)
		vi.restoreAllMocks()
	})

	it('vehicle namespace exposes script vehicle job entry points without merging onto work', async () => {
		game = new Game(
			{ terrainSeed: 9502, characterCount: 0 },
			{
				tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			}
		)
		await game.loaded
		game.ticker.stop()

		const character = game.population.createCharacter('W', { q: 0, r: 0 })
		const vehicle = character.scriptsContext.vehicle
		const work = character.scriptsContext.work
		expect(work.vehicleHop).toBeUndefined()
		for (const key of ['vehicleHop', 'zoneBrowse', 'vehicleOffload'] as const) {
			expect(vehicle[key], key).toBeDefined()
			expect(typeof vehicle[key]).toBe('function')
		}
	})
})
