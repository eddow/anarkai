import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Hive } from 'ssh/hive/hive'
import type { StorageAlveolus } from 'ssh/hive/storage'
import type { HomePlan } from 'ssh/types/base'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('Script execution regressions', () => {
	it('goHome falls back to a real ScriptExecution step when no home exists', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const worker = engine.spawnCharacter('Homeless', { q: 0, r: 0 })
			const action = worker.scriptsContext.selfCare.goHome()

			expect(() => worker.begin(action)).not.toThrow()
			expect(() => engine.tick(0.1)).not.toThrow()
			expect(worker.stepExecutor).toBeDefined()
		} finally {
			await engine.destroy()
		}
	})

	it('walk.until yields a step when the path is already satisfied', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const worker = engine.spawnCharacter('Looper', { q: 0, r: 0 })
			const execution = worker.scriptsContext.walk.until([{ q: 0, r: 0 }])
			const first = execution.run(worker.scriptsContext)

			expect(first.type).toBe('yield')
			if (first.type !== 'yield') throw new Error('walk.until should yield a pause step')
			expect(first.value.description).toBe('walk.pause')
		} finally {
			await engine.destroy()
		}
	})

	it('walk.until yields for a non-empty no-op path so callers cannot busy-spin', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const worker = engine.spawnCharacter('Pacer', { q: 0, r: 0 })
			const execution = worker.scriptsContext.walk.until([{ q: 1, r: 0 }])
			const first = execution.run(worker.scriptsContext)
			expect(first.type).toBe('yield')
			if (first.type !== 'yield') throw new Error('walk.until should yield a completion pause')
			expect(first.value.description).toBe('walk.pause')
		} finally {
			await engine.destroy()
		}
	})

	it('walk.moveTo skips zero-duration movement steps', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const worker = engine.spawnCharacter('Sprinter', { q: 0, r: 0 })
			worker.tile.content = {
				tile: worker.tile,
				name: 'zero-walk-test',
				debugInfo: {},
				walkTime: 0,
				background: '',
				storage: undefined,
				destroy() {},
			} as any

			expect(worker.scriptsContext.walk.moveTo({ q: 1, r: 0 })).toBeUndefined()
		} finally {
			await engine.destroy()
		}
	})

	it('home plans own and release residential reservations', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const worker = engine.spawnCharacter('Sleeper', { q: 0, r: 0 })
			const target = { q: 0, r: 0 }
			engine.game.hex.zoneManager.setZone(target, 'residential')
			const homePlan: HomePlan = {
				type: 'home',
				kind: 'residential',
				target,
				path: [],
			}

			worker.scriptsContext.plan.begin(homePlan)
			expect(engine.game.hex.zoneManager.getReservation(worker)).toEqual(target)

			worker.scriptsContext.plan.conclude(homePlan)
			expect(engine.game.hex.zoneManager.getReservation(worker)).toBeUndefined()
		} finally {
			await engine.destroy()
		}
	})

	it('convey approach enters the target tile center before work starts', () => {
		const script = readFileSync(resolve(__dirname, '../../assets/scripts/work.npcs'), 'utf8')
		const conveyBody = script.match(/function convey\(jobPlan\)([\s\S]*?)end function/)?.[1]

		expect(conveyBody).toContain('walk.into path')
		expect(conveyBody).not.toContain('walk.until path')
	})

	it('convey returns for replan instead of spinning when the worker is off the assigned tile', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			engine.loadScenario({
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				hives: [
					{
						name: 'ConveyReplanHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: { wood: 1 } },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
			} as any)

			const provider = engine.game.hex.getTile({ q: 0, r: 0 })!.content as StorageAlveolus
			const demander = engine.game.hex.getTile({ q: 1, r: 0 })!.content as StorageAlveolus
			expect((provider.hive as Hive).createMovement('wood', provider, demander)).toBe(true)
			expect(provider.aGoodMovement?.length).toBe(1)

			const worker = engine.spawnCharacter('OffTileConveyor', { q: 0, r: 1 })
			worker.assignedAlveolus = provider
			provider.assignedWorker = worker

			const execution = worker.scriptsContext.work.goWork({
				type: 'work',
				job: 'convey',
				target: provider,
				path: [],
				urgency: 1,
				fatigue: 1,
			})

			worker.begin(execution)
			expect(() => engine.tick(0.5)).not.toThrow()
			expect(worker.actionDescription).not.toContain('work.conveyStep')
		} finally {
			await engine.destroy()
		}
	})

	it('stale convey execution waits and invalidates instead of finishing immediately', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			engine.loadScenario({
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				hives: [
					{
						name: 'StaleConveyHive',
						alveoli: [{ coord: [0, 0], alveolus: 'storage', goods: {} }],
					},
				],
			} as any)

			const storage = engine.game.hex.getTile({ q: 0, r: 0 })!.content as StorageAlveolus
			const worker = engine.spawnCharacter('StaleConveyor', { q: 0, r: 0 })
			worker.assignedAlveolus = storage
			storage.assignedWorker = worker

			const beforeRevision = (storage.hive as Hive).conveyPlanningRevision
			const execution = worker.scriptsContext.work.goWork({
				type: 'work',
				job: 'convey',
				target: storage,
				path: [],
				urgency: 1,
				fatigue: 1,
			})

			worker.begin(execution)

			expect(worker.stepExecutor?.description).toBe('waitForIncomingGoods')
			expect((storage.hive as Hive).conveyPlanningRevision).toBeGreaterThan(beforeRevision)
		} finally {
			await engine.destroy()
		}
	})
})
