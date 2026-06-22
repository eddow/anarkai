// @ts-nocheck
import { inert } from 'mutts'
import { Game, type GamePatches } from 'ssh/game'
import type { ScriptExecution } from 'ssh/npcs/scripts'
import { PonderingStep } from 'ssh/npcs/steps'
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
} satisfies GamePatches

describe('Eat planning vs hunger (no goEat when sated)', () => {
	beforeAll(() => {
		Game.prototype.getTexture = function (this: Game, _spec: string) {
			return { defaultAnchor: { x: 0.5, y: 0.5 }, width: 1, height: 1 }
		}
	})

	afterAll(() => {
		delete (Game.prototype as Partial<Game>).getTexture
	})

	async function loadMiniGame(gamePatches: GamePatches = patches) {
		const game = new Game(
			{
				terrainSeed: 42_001,
				characterCount: 0,
				characterRadius: 4,
			},
			gamePatches
		)
		await game.loaded
		game.ticker.stop()
		return game
	}

	function clearLooseGoods(game: Game) {
		for (const goods of game.hex.looseGoods.goods.values()) {
			for (const good of [...goods]) good.remove()
		}
	}

	it('computeActivityScores omits eat when hunger is fully sated (-1) despite reachable food', async () => {
		const game = await loadMiniGame()
		try {
			const c = game.population.createCharacter('Sated', { q: 0, r: -1 })
			c.hunger = -1
			const scores = inert(() => computeActivityScores(c))
			expect(scores.some((s) => s.kind === 'eat')).toBe(false)
		} finally {
			game.destroy()
		}
	})

	it('computeActivityScores includes eat when hungry with reachable food', async () => {
		const game = await loadMiniGame()
		try {
			const c = game.population.createCharacter('Hungry', { q: 0, r: -1 })
			c.hunger = 0.92
			const scores = inert(() => computeActivityScores(c))
			expect(scores.some((s) => s.kind === 'eat')).toBe(true)
		} finally {
			game.destroy()
		}
	})

	it('computeActivityScores includes eat when hungry with personal food and no world food', async () => {
		const game = await loadMiniGame({ hives: [] })
		try {
			clearLooseGoods(game)
			const c = game.population.createCharacter('PocketSnack', { q: 0, r: -1 })
			c.hunger = 0.92
			c.addPersonalGood('bread', 1)
			const scores = inert(() => computeActivityScores(c))
			expect(scores.some((s) => s.kind === 'eat')).toBe(true)
		} finally {
			game.destroy()
		}
	})

	it('tryScriptForActivityKind(eat) is false when sated even with reachable food', async () => {
		const game = await loadMiniGame()
		try {
			const c = game.population.createCharacter('Sated2', { q: 0, r: -1 })
			c.hunger = -1
			const exec = inert(() => (c as unknown as TryKind).tryScriptForActivityKind('eat'))
			expect(exec).toBe(false)
		} finally {
			game.destroy()
		}
	})

	it('tryScriptForActivityKind(eat) returns execution when hungry with reachable food', async () => {
		const game = await loadMiniGame()
		try {
			const c = game.population.createCharacter('Hungry2', { q: 0, r: -1 })
			c.hunger = 0.92
			const exec = inert(() => (c as unknown as TryKind).tryScriptForActivityKind('eat'))
			expect(exec).not.toBe(false)
			expect(exec).toHaveProperty('name')
			expect(String((exec as ScriptExecution).name)).toMatch(/goEat/i)
		} finally {
			game.destroy()
		}
	})

	it('find.food ignores sub-unit storage stock that cannot be eaten', async () => {
		const game = await loadMiniGame({
			hives: [
				{
					name: 'Mini',
					alveoli: [
						{
							coord: [0, 0],
							alveolus: 'storage',
							goods: { berries: 0.5 },
						},
					],
				},
			],
		})
		try {
			clearLooseGoods(game)
			const c = game.population.createCharacter('HungryFractional', { q: 0, r: -1 })
			c.hunger = 0.92
			expect(c.scriptsContext.find.food()).toBe(false)
		} finally {
			game.destroy()
		}
	})

	it('eatFromWorld ponders when planned food was already consumed', async () => {
		const game = await loadMiniGame({
			hives: [
				{
					name: 'Mini',
					alveoli: [
						{
							coord: [0, 0],
							alveolus: 'storage',
							goods: { berries: 1 },
						},
					],
				},
			],
		})
		try {
			const tile = game.hex.getTile({ q: 0, r: 0 })
			if (!tile) throw new Error('expected storage tile')
			const first = game.population.createCharacter('First', { q: 0, r: -1 })
			const second = game.population.createCharacter('Second', { q: 1, r: -1 })

			first.scriptsContext.selfCare.eatFromWorld('berries', tile)
			const stale = second.scriptsContext.selfCare.eatFromWorld('berries', tile)

			expect(stale).toBeInstanceOf(PonderingStep)
		} finally {
			game.destroy()
		}
	})

	it('takes food from storage into personal inventory and eats from it', async () => {
		const game = await loadMiniGame({
			hives: [
				{
					name: 'Mini',
					alveoli: [
						{
							coord: [0, 0],
							alveolus: 'storage',
							goods: { bread: 1 },
						},
					],
				},
			],
		})
		try {
			const tile = game.hex.getTile({ q: 0, r: 0 })
			if (!tile) throw new Error('expected storage tile')
			const c = game.population.createCharacter('Customer', { q: 0, r: -1 })
			c.hunger = 0.92

			expect(c.scriptsContext.selfCare.takeFoodFromWorld('bread', tile)).toBe(true)
			expect(c.personalGoodAvailable('bread')).toBe(1)
			expect(tile.content?.storage?.available('bread')).toBe(0)

			const step = c.scriptsContext.selfCare.eatFromInventory('bread')
			expect(c.personalGoodAvailable('bread')).toBe(0)
			step.tick(step.duration)
			expect(c.hunger).toBeLessThan(0.92)
		} finally {
			game.destroy()
		}
	})

	it('serializes and restores personal inventory', async () => {
		const game = await loadMiniGame({ hives: [] })
		try {
			const c = game.population.createCharacter('Keeper', { q: 0, r: -1 })
			c.addPersonalGood('sandwich', 2)
			const saved = c.serialize()
			const restoredGame = await loadMiniGame({ hives: [] })
			try {
				restoredGame.population.deserialize([saved])
				const restored = restoredGame.population.characters.get(c.uid)
				if (!restored) throw new Error('expected restored character')
				expect(restored.personalGoodAvailable('sandwich')).toBe(2)
			} finally {
				restoredGame.destroy()
			}
		} finally {
			game.destroy()
		}
	})
})
