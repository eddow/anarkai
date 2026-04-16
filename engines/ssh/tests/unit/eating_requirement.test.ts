import { chopSaw } from 'ssh/game/exampleGames'
import { Game } from 'ssh/game/game'
import { Character } from 'ssh/population/character'
import { describe, expect, it } from 'vitest'

describe('Eating (no carried-food buffer)', () => {
	it('Character prototype has no carriedFood getter', async () => {
		const game = new Game(
			{
				terrainSeed: 1,
				characterCount: 0,
				characterRadius: 5,
			},
			chopSaw
		)

		await game.loaded

		const char = new Character(game, 'test-char', 'Tester', { x: 0, y: 0 })
		expect(Object.getOwnPropertyDescriptor(Character.prototype, 'carriedFood')).toBeUndefined()
		expect(Object.getOwnPropertyNames(Object.getPrototypeOf(char))).not.toContain('carriedFood')
	})
})
