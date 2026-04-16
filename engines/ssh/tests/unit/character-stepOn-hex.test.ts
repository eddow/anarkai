import { Game } from 'ssh/game/game'
import { lerp } from 'ssh/npcs/utils'
import { axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import { describe, expect, it } from 'vitest'
import { bindOperatedWheelbarrowOffload } from '../test-engine/vehicle-bind'

describe('Character.stepOn hex adjacency', () => {
	it('allows stepping from a fractional axial midpoint onto a neighbor tile (walk.until pattern)', async () => {
		const gen = { terrainSeed: 9401, characterCount: 0 }
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
		}
		const game = new Game(gen, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('v-step', 'wheelbarrow', { q: 0, r: 0 })
		const character = game.population.createCharacter('Stepper', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()

		const a = character.tile.position
		const b = game.hex.getTile({ q: 1, r: 0 })!.position
		character.position = lerp(a, b, 0.5) as typeof character.position

		const neighbor = game.hex.getTile({ q: 1, r: 0 })!
		const stepped = character.stepOn(neighbor)
		expect(stepped).not.toBe(false)

		expect(axial.key(axial.round(toAxialCoord(character.tile.position)!))).toBe('1,0')
		const mid = lerp(a, b, 0.5)
		// `stepOn` updates occupancy/discrete tile; continuous position is completed by `walk.moveTo(dest)` in `walk.until`.
		expect(axial.key(axial.round(toAxialCoord(character.position)!))).toBe(
			axial.key(axial.round(toAxialCoord(mid)!))
		)

		game.destroy()
	})
})
