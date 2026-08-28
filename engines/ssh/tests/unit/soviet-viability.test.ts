import { soviet } from 'ssh/game/exampleGames'
import { describe, expect, it } from 'vitest'
import { runViabilityScenario } from '../test-engine/viability'

describe('Soviet viability', () => {
	it('runs the soviet world for 60 virtual seconds without the offload path error', async () => {
		const ctx = await runViabilityScenario(
			{
				generation: { terrainSeed: 549, characterCount: 6, characterRadius: 5 },
				patches: soviet,
			},
			({ errors }) => {
				const offload = errors.filter((e) => e.includes('No path to vehicleOffload pickup tile'))
				expect(offload).toEqual([])
			},
			{
				virtualSeconds: 60,
				tickElapsedMs: 250,
				forbiddenErrorSubstrings: [
					'No path to vehicleOffload pickup tile',
					'script.executionError',
				],
			}
		)
		expect(ctx.virtualTime).toBeGreaterThanOrEqual(60)
	}, 60000)
})
