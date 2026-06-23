import { Game } from 'ssh/game/game'
import { lerp } from 'ssh/npcs/utils'
import { axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import { describe, expect, it } from 'vitest'

describe('workPlanningRevision', () => {
	it('does not bump on position lerp within the same tile', async () => {
		const game = new Game(
			{ terrainSeed: 9401, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0] as const, terrain: 'grass' as const },
					{ coord: [1, 0] as const, terrain: 'grass' as const },
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		const character = game.population.createCharacter('LerpTest', { q: 0, r: 0 })
		const before = game.workPlanningRevision

		// Lerp within the same axial tile — should NOT bump the revision
		character.position = { q: 0.4, r: 0 } as typeof character.position
		expect(game.workPlanningRevision).toBe(before)

		character.position = { q: 0.8, r: 0.2 } as typeof character.position
		expect(game.workPlanningRevision).toBe(before)

		game.destroy()
	}, 15000)

	it('does not bump on stepOn to an adjacent tile', async () => {
		const game = new Game(
			{ terrainSeed: 9401, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0] as const, terrain: 'grass' as const },
					{ coord: [1, 0] as const, terrain: 'grass' as const },
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		const character = game.population.createCharacter('StepTest', { q: 0, r: 0 })

		// Move to the lerp midpoint first (canonical walk.until pattern)
		const a = character.tile.position
		const b = game.hex.getTile({ q: 1, r: 0 })!.position
		character.position = lerp(a, b, 0.5) as typeof character.position

		const before = game.workPlanningRevision

		// stepOn changes _tile but should NOT bump work-planning revision
		const neighbor = game.hex.getTile({ q: 1, r: 0 })!
		character.stepOn(neighbor)
		expect(game.workPlanningRevision).toBe(before)
		expect(axial.key(axial.round(toAxialCoord(character.tile.position)!))).toBe('1,0')

		game.destroy()
	}, 15000)

	it('bumps on loose-good.add (real blocker)', async () => {
		const game = new Game(
			{ terrainSeed: 9401, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0] as const, terrain: 'grass' as const },
					{ coord: [1, 0] as const, terrain: 'grass' as const },
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		const before = game.workPlanningRevision
		const tile = game.hex.getTile({ q: 0, r: 0 })!

		// Adding a loose good is a real world-state change — must bump
		game.hex.looseGoods.add(tile, 'wood')
		expect(game.workPlanningRevision).toBeGreaterThan(before)

		game.destroy()
	}, 15000)

	it('bumps on loose-good.remove (real blocker — disappearing good)', async () => {
		const game = new Game(
			{ terrainSeed: 9401, characterCount: 0 },
			{
				tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			}
		)
		await game.loaded
		game.ticker.stop()

		const tile = game.hex.getTile({ q: 0, r: 0 })!
		const good = game.hex.looseGoods.add(tile, 'wood')
		const before = game.workPlanningRevision

		// Removing a loose good is a real blocker — must bump
		good.remove()
		expect(game.workPlanningRevision).toBeGreaterThan(before)

		game.destroy()
	}, 15000)

	it('does not bump after loose-good when only position changes', async () => {
		const game = new Game(
			{ terrainSeed: 9401, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0] as const, terrain: 'grass' as const },
					{ coord: [1, 0] as const, terrain: 'grass' as const },
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		const character = game.population.createCharacter('ComboTest', { q: 0, r: 0 })
		const tile = game.hex.getTile({ q: 0, r: 0 })!
		game.hex.looseGoods.add(tile, 'wood')
		const afterAdd = game.workPlanningRevision

		// Position lerp after a real blocker — still should NOT bump
		character.position = { q: 0.3, r: 0.1 } as typeof character.position
		expect(game.workPlanningRevision).toBe(afterAdd)

		game.destroy()
	}, 15000)
})
