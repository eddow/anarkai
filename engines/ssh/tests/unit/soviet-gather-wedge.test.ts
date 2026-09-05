// @ts-nocheck
import { listHives } from 'ssh/commerce/board-sources'
import { soviet } from 'ssh/game/exampleGames'
import { describe, expect, it } from 'vitest'
import { runViabilityScenario } from '../test-engine/viability'

describe('Soviet gather wedge', () => {
	// Watchdog: on clean baseline this passes (no console crash). It guards against
	// re-introducing the `No path found to target` / destroyed-provider crashes that the
	// colleague's job-link refactor caused.
	it('runs the soviet world with vehicle operators for 180 virtual seconds without a path error', async () => {
		const ctx = await runViabilityScenario(
			{
				generation: { terrainSeed: 549, characterCount: 12, characterRadius: 6 },
				patches: soviet,
			},
			({ errors }) => {
				const pathErrors = errors.filter((e) => e.includes('No path found to target'))
				expect(pathErrors).toEqual([])
			},
			{
				virtualSeconds: 180,
				tickElapsedMs: 250,
				forbiddenErrorSubstrings: ['No path found to target', 'script.executionError'],
			}
		)
		expect(ctx.virtualTime).toBeGreaterThanOrEqual(180)
	}, 180000)

	// Behavioral wedge: the gather wheelbarrow must not end the run stuck holding an
	// undeliverable good (e.g. a mushroom it can never sink), and wood must actually reach a Wood
	// hive's storage. This is the real pre-existing problem (clear console, wrong behavior).
	it('gathers wood: no gather vehicle is left stuck with undeliverable cargo', async () => {
		const ctx = await runViabilityScenario(
			{
				generation: { terrainSeed: 549, characterCount: 12, characterRadius: 6 },
				patches: soviet,
			},
			({ game }) => {
				// No vehicle should be wedged carrying a good its line cannot sink (e.g. a mushroom
				// on a wood-only gather line).
				const wedged = [...game.vehicles].filter((v) => {
					const stock = Object.entries(v.storage.stock).filter(([, q]) => (q ?? 0) > 0)
					return stock.some(
						([good]) =>
							good !== 'wood' && good !== 'stone' && good !== 'planks' && good !== 'concrete'
					)
				})
				expect(
					wedged.map((v) => ({ name: v.name, stock: v.storage.stock })),
					'vehicle stuck with undeliverable cargo'
				).toEqual([])
				// Wood must have reached at least one Wood hive's alveolus storage.
				const woodHives = listHives(game).filter((h) => h.name.startsWith('Wood'))
				const woodStored = woodHives.reduce(
					(total, hive) =>
						total +
						[...hive.alveoli].reduce((sum, alv) => sum + (alv.storage?.stock?.wood ?? 0), 0),
					0
				)
				expect(woodStored, 'no wood gathered into any Wood hive').toBeGreaterThan(0)
				// Convey must actually move wood pile → sawmill → planks. Planks anywhere prove the
				// sawmill consumed conveyed wood (not just that wood sat in the pile buffer).
				const planksProduced = woodHives.reduce(
					(total, hive) =>
						total +
						[...hive.alveoli].reduce((sum, alv) => sum + (alv.storage?.stock?.planks ?? 0), 0),
					0
				)
				expect(
					planksProduced,
					'no planks produced (wood never conveyed to sawmill)'
				).toBeGreaterThan(0)
			},
			{
				virtualSeconds: 180,
				tickElapsedMs: 250,
				forbiddenErrorSubstrings: ['No path found to target', 'script.executionError'],
			}
		)
		expect(ctx.virtualTime).toBeGreaterThanOrEqual(180)
	}, 180000)
})
