import { Game } from 'ssh/game'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runViabilityScenario, type ViabilitySetup } from '../test-engine/viability'

function minimalSelfCareHiveSetup(
	afterLoad: NonNullable<ViabilitySetup['afterLoad']>
): ViabilitySetup {
	return {
		generation: {
			terrainSeed: 42_001,
			characterCount: 0,
			characterRadius: 4,
		},
		patches: {
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
			zones: [{ type: 'residential', coords: [[0, 1]] }],
		},
		afterLoad,
	}
}

describe('Viability: self-care + minimal hive', () => {
	beforeAll(() => {
		Game.prototype.getTexture = function (this: Game, _spec: string) {
			return { defaultAnchor: { x: 0.5, y: 0.5 }, width: 1, height: 1 }
		}
	})

	afterAll(() => {
		delete (Game.prototype as Partial<Game>).getTexture
	})

	it('sated (-1 hunger): no Action infinite fail (must not plan goEat)', async () => {
		let worker: any = null
		await runViabilityScenario(
			minimalSelfCareHiveSetup(({ game }) => {
				const w = game.population.createCharacter('Sated', { q: 0, r: -1 })
				worker = w
				w.hunger = -1
			}),
			({ game, errors, virtualTime }) => {
				expect(virtualTime).toBeGreaterThanOrEqual(44)
				expect(Array.from(game.population).includes(worker)).toBe(true)
				expect(errors.join('\n')).not.toMatch(/Action infinite fail/)
			},
			{ virtualSeconds: 45, tickElapsedMs: 250 }
		)
	}, 30_000)

	it('quick: no goEat / self-care deadlock over ~1 simulated minute (60 virtual seconds)', async () => {
		let worker: any = null
		await runViabilityScenario(
			minimalSelfCareHiveSetup(({ game }) => {
				const w = game.population.createCharacter('Solo', { q: 0, r: -1 })
				worker = w
				w.hunger = 0.92
			}),
			({ game, errors, virtualTime }) => {
				expect(virtualTime).toBeGreaterThanOrEqual(59)
				expect(Array.from(game.population).includes(worker)).toBe(true)
				expect(errors.join('\n')).not.toMatch(/Action infinite fail/)
			},
			{ virtualSeconds: 60, tickElapsedMs: 250 }
		)
	}, 30_000)

	it('one worker, one storage with food, residential tile: no goEat deadlock over five simulated minutes', async () => {
		let worker: any = null
		await runViabilityScenario(
			minimalSelfCareHiveSetup(({ game }) => {
				const w = game.population.createCharacter('Solo', { q: 0, r: -1 })
				worker = w
				w.hunger = 0.92
			}),
			({ game, errors, virtualTime }) => {
				expect(virtualTime).toBeGreaterThanOrEqual(299)
				expect(Array.from(game.population).includes(worker)).toBe(true)
				expect(errors.join('\n')).not.toMatch(/Action infinite fail/)
			},
			{ virtualSeconds: 300, tickElapsedMs: 250 }
		)
	}, 60_000)
})
