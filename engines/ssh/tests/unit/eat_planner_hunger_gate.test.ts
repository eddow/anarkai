import { inert } from 'mutts'
import { Game } from 'ssh/game'
import type { ScriptExecution } from 'ssh/npcs/scripts'
import type { Character } from 'ssh/population/character'
import { computeActivityScores } from 'ssh/population/findNextActivity'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

type TryKind = Pick<Character, never> & {
	tryScriptForActivityKind(kind: string): ScriptExecution | false | undefined
}

/** Same board as viability self-care: storage + berries, residential, worker spawn tile. */
const patches = {
	hives: [
		{
			name: 'Mini',
			alveoli: [
				{
					coord: [0, 0],
					alveolus: 'storage',
					goods: { berries: 24 },
				},
			],
		},
	],
	zones: {
		residential: [[0, 1]],
	},
} as const

describe('Eat planning vs hunger (no goEat when sated)', () => {
	beforeAll(() => {
		Game.prototype.getTexture = function (this: Game, _spec: string) {
			return { defaultAnchor: { x: 0.5, y: 0.5 }, width: 1, height: 1 }
		}
	})

	afterAll(() => {
		delete (Game.prototype as Partial<Game>).getTexture
	})

	async function loadMiniGame() {
		const game = new Game(
			{
				terrainSeed: 42_001,
				characterCount: 0,
				characterRadius: 4,
			},
			patches
		)
		await game.loaded
		game.ticker.stop()
		return game
	}

	it('computeActivityScores omits eat when hunger is fully sated (-1) despite carried food', async () => {
		const game = await loadMiniGame()
		try {
			const c = game.population.createCharacter('Sated', { q: 0, r: -1 })
			c.carry.addGood('berries', 4)
			c.hunger = -1
			const scores = inert(() => computeActivityScores(c))
			expect(scores.some((s) => s.kind === 'eat')).toBe(false)
		} finally {
			game.destroy()
		}
	})

	it('computeActivityScores includes eat when hungry with carried food', async () => {
		const game = await loadMiniGame()
		try {
			const c = game.population.createCharacter('Hungry', { q: 0, r: -1 })
			c.carry.addGood('berries', 4)
			c.hunger = 0.92
			const scores = inert(() => computeActivityScores(c))
			expect(scores.some((s) => s.kind === 'eat')).toBe(true)
		} finally {
			game.destroy()
		}
	})

	it('tryScriptForActivityKind(eat) is false when sated even with carried food', async () => {
		const game = await loadMiniGame()
		try {
			const c = game.population.createCharacter('Sated2', { q: 0, r: -1 })
			c.carry.addGood('berries', 4)
			c.hunger = -1
			const exec = inert(() => (c as unknown as TryKind).tryScriptForActivityKind('eat'))
			expect(exec).toBe(false)
		} finally {
			game.destroy()
		}
	})

	it('tryScriptForActivityKind(eat) returns execution when hungry with carried food', async () => {
		const game = await loadMiniGame()
		try {
			const c = game.population.createCharacter('Hungry2', { q: 0, r: -1 })
			c.carry.addGood('berries', 4)
			c.hunger = 0.92
			const exec = inert(() => (c as unknown as TryKind).tryScriptForActivityKind('eat'))
			expect(exec).not.toBe(false)
			expect(exec).toHaveProperty('name')
			expect(String((exec as ScriptExecution).name)).toMatch(/goEat/i)
		} finally {
			game.destroy()
		}
	})
})
