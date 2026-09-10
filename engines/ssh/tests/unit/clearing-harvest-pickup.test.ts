import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { AxialCoord } from 'ssh/utils'
import { afterEach, describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine/engine'

/**
 * Clearing-harvest diagnosis: a committed construction site carrying a matching
 * deposit should surface a `project`-priority harvest job that a worker picks.
 */
describe('clearing harvest pickup', () => {
	let engine: TestEngine | undefined

	afterEach(async () => {
		await engine?.destroy()
		engine = undefined
	})

	it('a worker picks the clearing job on a committed site with a deposit', async () => {
		engine = new TestEngine({ terrainSeed: 77, characterCount: 0 })
		await engine.init()
		engine.loadScenario({
			tiles: [
				{ coord: [1, 0], terrain: 'forest' },
				{ coord: [2, 0], terrain: 'forest' },
			],
			hives: [
				{
					name: 'Choppers',
					alveoli: [{ coord: [0, 0], alveolus: 'tree_chopper' }],
				},
			],
		} as never)

		// Committed site with a matching deposit on [1,0].
		const { project } = engine.game.projects.createDraft('Clear', [
			{ coord: [1, 0], alveolusType: 'storage' },
		])
		const commit = engine.game.commitProject(project)
		expect(commit.ok).toBe(true)
		const siteTile = engine.game.hex.getTile({ q: 1, r: 0 })!
		expect(siteTile.content).toBeInstanceOf(UnBuiltLand)
		const land = siteTile.content as UnBuiltLand
		expect(land.site).toBeTruthy()
		const { Deposit } = await import('ssh/board/content/unbuilt-land')
		land.deposit = Deposit.create('tree', 4)
		engine.game.notifyTerrainDepositsChanged(siteTile)

		const worker = engine.game.population.createCharacter(
			'Clearer',
			{ q: 2, r: 0 } as AxialCoord
		)
		worker.role = 'worker'
		void worker.scriptsContext

		// The harvester-side path must expose the project-priority job.
		const chopper = engine.game.hex.getTile({ q: 0, r: 0 })!.content as {
			getJob(character: unknown): { job: string } | undefined
			proposedJobs: readonly { job: { job: string } }[]
		}
		const direct = chopper.getJob(worker)
		expect(direct?.job).toBe('harvest')

		// And the worker's ranked list must contain it (not silently dropped).
		const snapshot = worker.workPlannerSnapshot
		const harvestRows = (snapshot?.ranked ?? []).filter(
			(candidate) => candidate.jobKind === 'harvest'
		)
		expect(harvestRows.length).toBeGreaterThan(0)

		// End-to-end: the worker actually starts harvest work.
		const action = worker.findAction()
		expect(action).toBeTruthy()
	})}
)
