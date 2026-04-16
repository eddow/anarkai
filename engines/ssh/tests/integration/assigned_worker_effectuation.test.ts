import type { SaveState } from 'ssh/game'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

async function flushDeferred(turns: number = 3) {
	for (let i = 0; i < turns; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0))
	}
}

describe('Assigned worker effectuation', () => {
	it('resolves a pre-assigned gather worker to work.goWork when assigned work exists', {
		timeout: 20000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'AssignedGatherHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'freight_bay', goods: {} },
							{ coord: [1, 0], alveolus: 'sawmill', goods: {} },
						],
					},
				],
				looseGoods: [{ position: { q: 0, r: 1 }, goodType: 'wood' }],
			}

			engine.loadScenario(scenario)
			await flushDeferred()

			const gather = engine.game.hex.getTile({ q: 0, r: 0 })?.content as any
			expect(gather).toBeDefined()
			if (!gather) throw new Error('Expected gatherer to exist')

			const line = engine.game.freightLines[0]
			if (!line) throw new Error('Expected implicit gather freight line for road-fret bay')

			const worker = engine.spawnCharacter('AssignedGatherWorker', { q: 0, r: 0 })
			worker.role = 'worker'
			void worker.scriptsContext

			const vehicle = engine.game.vehicles.createVehicle(
				'assigned-wb',
				'wheelbarrow',
				{ q: 0, r: 0 },
				[line]
			)
			vehicle.beginService(line, line.stops[0]!, worker)
			worker.operates = vehicle
			worker.onboard()

			worker.assignedAlveolus = gather
			gather.assignedWorker = worker

			const firstAction = worker.findAction()
			expect(firstAction).toBeDefined()
			expect(firstAction?.name).toBe('work.goWork')
			expect(
				worker.resolveBestJobMatch()?.targetTile?.content,
				'best job should respect assignment'
			).toBe(gather.tile.content)
			expect(worker.assignedAlveolus).toBe(gather)
			expect(gather.assignedWorker).toBe(worker)
		} finally {
			await engine.destroy()
		}
	})
})
