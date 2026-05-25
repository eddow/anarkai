import { chopSaw } from 'ssh/game/exampleGames'
import { describe, expect, it } from 'vitest'
import { runViabilityScenario } from '../test-engine/viability'

describe('ChopSaw viability', () => {
	it('runs the example for five virtual minutes without vehicle dock script errors', async () => {
		const ctx = await runViabilityScenario(
			{
				generation: {
					terrainSeed: 549,
					characterCount: 3,
					characterRadius: 5,
				},
				patches: chopSaw,
			},
			({ errors, virtualTime }) => {
				expect(virtualTime).toBeGreaterThanOrEqual(300)
				expect(errors.join('\n')).not.toMatch(/dock requires vehicle to be on the anchor tile/)
			},
			{
				virtualSeconds: 300,
				tickElapsedMs: 250,
				forbiddenErrorSubstrings: [
					'dock requires vehicle to be on the anchor tile',
					'script.executionError',
				],
			}
		)

		expect(ctx.virtualTime).toBeGreaterThanOrEqual(300)
	}, 30000)

	it('imports concrete through the live materials loop', async () => {
		const ctx = await runViabilityScenario(
			{
				generation: {
					terrainSeed: 549,
					characterCount: 3,
					characterRadius: 5,
				},
				patches: chopSaw,
				afterLoad: ({ game }) => {
					game.setPlayerAccountBalance(1000)
				},
			},
			({ game, virtualTime }) => {
				const pickup = game.vehicles.vehicle('ChopSaw:pickup-truck')
				const storage = game.hex.getTile({ q: 0, r: -1 })?.content as
					| { storage?: { stock: Partial<Record<string, number>> } }
					| undefined
				expect(virtualTime).toBeGreaterThanOrEqual(300)
				const concreteTotal =
					(pickup?.storage.stock.concrete ?? 0) + (storage?.storage?.stock.concrete ?? 0)
				expect(concreteTotal).toBeGreaterThan(0)
			},
			{
				virtualSeconds: 300,
				tickElapsedMs: 250,
				forbiddenErrorSubstrings: ['script.executionError'],
			}
		)

		expect(ctx.virtualTime).toBeGreaterThanOrEqual(300)
	}, 30000)
})
