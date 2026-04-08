import { inert } from 'mutts'
import type { SaveState } from 'ssh/game'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine/engine'

describe('Ranked work diagnostics', () => {
	it('captures sorted ranked work candidates and flags the selected winner', async () => {
		const engine = new TestEngine({
			terrainSeed: 42_001,
			characterCount: 0,
		})
		await engine.init()

		try {
			const scenario: Partial<SaveState> = {
				generationOptions: {
					terrainSeed: 42_001,
					characterCount: 0,
				},
				tiles: [
					{
						coord: [1, 0],
						deposit: { type: 'tree', amount: 10 },
						terrain: 'forest',
					},
				],
				hives: [
					{
						name: 'WorkHive',
						alveoli: [{ coord: [1, 2], alveolus: 'tree_chopper', goods: {} }],
					},
				],
				zones: {
					harvest: [[1, 0]],
				},
			}

			engine.loadScenario(scenario)
			const worker = engine.spawnCharacter('Worker', { q: 2, r: 2 })
			;(worker as { role?: string }).role = 'worker'
			void worker.scriptsContext
			worker.hunger = -0.35
			worker.fatigue = -0.28
			worker.tiredness = -0.4

			inert(() => {
				void worker.findAction()
			})

			expect(worker.lastWorkPlannerSnapshot).toBeDefined()
			const ranked = worker.lastWorkPlannerSnapshot!.ranked
			expect(ranked.length).toBeGreaterThan(0)
			expect(ranked[0]?.jobKind).toBe('harvest')
			expect(ranked[0]?.selected).toBe(true)
			expect(ranked.every((candidate, index, arr) => index === 0 || arr[index - 1]!.score >= candidate.score)).toBe(true)
		} finally {
			await engine.destroy()
		}
	})

	it('keeps a convey candidate visible when a higher-priority work job wins', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'DiagHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: {} },
							{ coord: [1, 0], alveolus: 'sawmill', goods: {} },
							{ coord: [0, 1], alveolus: 'storage', goods: {} },
						],
					},
				],
				looseGoods: [{ goodType: 'wood', position: { q: 0, r: 1 } }],
			}

			engine.loadScenario(scenario)

			const storage = engine.game.hex.getTile({ q: 0, r: 0 })?.content as any
			storage.hive.movingGoods.set({ q: 0, r: 0 }, [
				{
					goodType: 'wood',
					from: { q: 0, r: 0 },
					path: [
						{ q: 0.5, r: 0 },
						{ q: 1, r: 0 },
					],
				},
			])

			const worker = engine.spawnCharacter('Worker', { q: 1, r: 1 })
			;(worker as { role?: string }).role = 'worker'
			void worker.scriptsContext

			inert(() => {
				void worker.findAction()
			})

			expect(worker.lastPlannerSnapshot?.outcome.kind).toBe('bestWork')
			expect(worker.lastWorkPlannerSnapshot).toBeDefined()

			const ranked = worker.lastWorkPlannerSnapshot!.ranked
			expect(ranked.some((candidate) => candidate.jobKind === 'convey')).toBe(true)
			const winner = ranked.find((candidate) => candidate.selected)
			expect(winner?.jobKind).toBe('offload')
			const convey = ranked.find((candidate) => candidate.jobKind === 'convey')
			expect(convey?.selected).toBe(false)
		} finally {
			await engine.destroy()
		}
	})

	it('falls back to the last non-empty ranked work snapshot when current work vanishes', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const worker = engine.spawnCharacter('Worker', { q: 0, r: 0 })
			;(worker as { role?: string }).role = 'worker'
			void worker.scriptsContext

			worker.lastWorkPlannerSnapshot = {
				ranked: [
					{
						jobKind: 'convey',
						targetLabel: 'storage @ 0, 0',
						targetCoord: { q: 0, r: 0 },
						urgency: 3,
						pathLength: 1,
						score: 1.5,
						selected: false,
					},
				],
			}

			expect(worker.workPlannerSnapshot).toEqual(worker.lastWorkPlannerSnapshot)
		} finally {
			await engine.destroy()
		}
	})
})
