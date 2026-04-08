import { inert } from 'mutts'
import { Game } from 'ssh/game'
import type { Character } from 'ssh/population/character'
import { computeActivityScores } from 'ssh/population/findNextActivity'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

type TryKind = {
	tryScriptForActivityKind(kind: string): unknown
}

const patches = {
	hives: [
		{
			name: 'Mini',
			alveoli: [
				{
					coord: [0, 0],
					alveolus: 'storage',
					goods: { berries: 8 },
				},
			],
		},
	],
	zones: {
		residential: [[0, 1]],
	},
} as const

describe('Home planning vs keepWorking (avoid everyone goHome when jobs matter)', () => {
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

	it('computeActivityScores omits home when keepWorking (fresh hunger/fatigue/tiredness)', async () => {
		const game = await loadMiniGame()
		try {
			const c = game.population.createCharacter('Worker', { q: 0, r: -1 })
			c.hunger = 0.1
			c.fatigue = 0.1
			c.tiredness = 0.05
			const scores = inert(() => computeActivityScores(c))
			expect(scores.some((s) => s.kind === 'home')).toBe(false)
		} finally {
			game.destroy()
		}
	})

	it('computeActivityScores can include home when not keepWorking (fatigue past high)', async () => {
		const game = await loadMiniGame()
		try {
			const c = game.population.createCharacter('Tired', { q: 0, r: -1 })
			c.hunger = 0.1
			c.fatigue = 0.55
			c.tiredness = 0.05
			const scores = inert(() => computeActivityScores(c))
			expect(scores.some((s) => s.kind === 'home')).toBe(true)
		} finally {
			game.destroy()
		}
	})

	it('computeActivityScores can include home when tiredness past high (hunger/fatigue ok)', async () => {
		const game = await loadMiniGame()
		try {
			const c = game.population.createCharacter('Sleepy', { q: 0, r: -1 })
			c.hunger = 0.1
			c.fatigue = 0.1
			c.tiredness = 0.55
			const scores = inert(() => computeActivityScores(c))
			expect(scores.some((s) => s.kind === 'home')).toBe(true)
		} finally {
			game.destroy()
		}
	})

	it('tryScriptForActivityKind(home) is false while keepWorking', async () => {
		const game = await loadMiniGame()
		try {
			const c = game.population.createCharacter('Fresh', { q: 0, r: -1 })
			c.hunger = 0.05
			c.fatigue = 0.05
			c.tiredness = 0.05
			const exec = inert(() => (c as unknown as TryKind).tryScriptForActivityKind('home'))
			expect(exec).toBe(false)
		} finally {
			game.destroy()
		}
	})

	it('tryScriptForActivityKind(home) runs when not keepWorking', async () => {
		const game = await loadMiniGame()
		try {
			const c = game.population.createCharacter('Done', { q: 0, r: -1 }) as Character
			c.hunger = 0.1
			c.fatigue = 0.55
			const exec = inert(() => (c as unknown as TryKind).tryScriptForActivityKind('home'))
			expect(exec).not.toBe(false)
		} finally {
			game.destroy()
		}
	})
})
