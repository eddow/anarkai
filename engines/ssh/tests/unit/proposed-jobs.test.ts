// @ts-nocheck
import { Alveolus } from 'ssh/board/content/alveolus'
import { Game } from 'ssh/game/game'
import { axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import { describe, expect, it, vi } from 'vitest'
import { gatherFreightLine } from '../freight-fixtures'
import { TestEngine } from '../test-engine/engine'

describe('proposed jobs', () => {
	it('exposes alveolus proposed jobs independently from character path tailoring', async () => {
		const engine = new TestEngine({
			terrainSeed: 42_101,
			characterCount: 0,
		})
		await engine.init()

		try {
			const scenario = {
				hives: [
					{
						name: 'WorkHive',
						alveoli: [{ coord: [1, 2], alveolus: 'sawmill', goods: { wood: 10 } }],
					},
				],
			}

			engine.loadScenario(scenario)
			const alveolus = engine.game.hex.getTile({ q: 1, r: 2 })?.content
			expect(alveolus).toBeInstanceOf(Alveolus)
			const proposed = (alveolus as Alveolus).proposedJobs[0]
			expect(proposed).toBeDefined()
			expect(proposed?.job).toBe('transform')
			expect(proposed?.source.kind).toBe('alveolus')
			expect(proposed?.targetTile).toBe((alveolus as Alveolus).tile)

			const near = engine.spawnCharacter('Near', { q: 1, r: 2 })
			const far = engine.spawnCharacter('Far', { q: 1, r: 1 })
			const nearCandidate = near.tailorProposedJob(proposed!)
			const farCandidate = far.tailorProposedJob(proposed!)
			expect(nearCandidate.available).toBe(true)
			expect(farCandidate.available).toBe(true)
			if (nearCandidate.available && farCandidate.available) {
				expect(nearCandidate.pathLength).toBeLessThan(farCandidate.pathLength)
			}
		} finally {
			await engine.destroy()
		}
	})

	it('returns blocked tailored candidates without making them planner-available', async () => {
		const engine = new TestEngine({
			terrainSeed: 42_102,
			characterCount: 0,
		})
		await engine.init()

		try {
			const scenario = {
				hives: [
					{
						name: 'BlockedHive',
						alveoli: [{ coord: [0, 0], alveolus: 'sawmill', goods: { wood: 2 } }],
					},
				],
			}
			engine.loadScenario(scenario)
			const alveolus = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus
			const owner = engine.spawnCharacter('Owner', { q: 0, r: 1 })
			const other = engine.spawnCharacter('Other', { q: 1, r: 0 })
			alveolus.assignedWorker = owner

			const proposed = alveolus.proposedJobs[0]
			expect(proposed).toBeDefined()
			const tailored = other.tailorProposedJob(proposed!)
			expect(tailored.available).toBe(false)
			if (!tailored.available) expect(tailored.blockedReason).toBe('assigned-worker')
			expect(
				other.workPlannerSnapshot?.ranked.some((row) => row.jobKind === proposed!.job) ?? false
			).toBe(false)
		} finally {
			await engine.destroy()
		}
	})

	it('dedupes vehicle proposed jobs while character tailoring keeps per-character paths', async () => {
		const line = gatherFreightLine({
			name: 'Proposed vehicle',
			hiveName: 'H',
			coord: [1, 0],
			filters: ['wood'],
			radius: 2,
		})
		const game = new Game(
			{ terrainSeed: 42_103, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0] as const, terrain: 'grass' as const },
					{ coord: [1, 0] as const, terrain: 'grass' as const },
					{ coord: [3, 0] as const, terrain: 'grass' as const },
				],
				hives: [
					{
						name: 'H',
						alveoli: [{ coord: [1, 0] as const, alveolus: 'sawmill' as const, goods: {} }],
					},
				],
				freightLines: [line],
				looseGoods: [{ goodType: 'wood' as const, position: { q: 0, r: 0 } }],
			}
		)
		await game.loaded
		game.ticker.stop()

		try {
			const vehicle = game.vehicles.createVehicle('wheelbarrow', { q: 1, r: 0 }, [line])
			const near = game.population.createCharacter('Near', { q: 1, r: 0 })
			const far = game.population.createCharacter('Far', { q: 3, r: 0 })

			const proposed = vehicle.proposedJobs.filter((job) => job.job === 'vehicleHop')
			expect(proposed).toHaveLength(1)
			expect(proposed[0]?.source.vehicle).toBe(vehicle)

			const nearCandidate = near.tailorProposedJob(proposed[0]!)
			const farCandidate = far.tailorProposedJob(proposed[0]!)
			expect(nearCandidate.available).toBe(true)
			expect(farCandidate.available).toBeDefined()
			if (nearCandidate.available && farCandidate.available) {
				expect(nearCandidate.pathLength).toBeLessThanOrEqual(farCandidate.pathLength)
				const nearLast = nearCandidate.path[nearCandidate.path.length - 1]
				if (nearLast) {
					expect(axial.key(nearLast)).toBe(axial.key(toAxialCoord(vehicle.effectivePosition)!))
				}
			}
		} finally {
			game.destroy()
		}
	})

	it('does not route a character planner pass through vehicle provider proposed jobs', async () => {
		const line = gatherFreightLine({
			name: 'Planner direct vehicle',
			hiveName: 'H',
			coord: [1, 0],
			filters: ['wood'],
			radius: 2,
		})
		const game = new Game(
			{ terrainSeed: 42_104, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0] as const, terrain: 'grass' as const },
					{ coord: [1, 0] as const, terrain: 'grass' as const },
				],
				hives: [
					{
						name: 'H',
						alveoli: [{ coord: [1, 0] as const, alveolus: 'sawmill' as const, goods: {} }],
					},
				],
				freightLines: [line],
				looseGoods: [{ goodType: 'wood' as const, position: { q: 0, r: 0 } }],
			}
		)
		await game.loaded
		game.ticker.stop()

		try {
			const vehicle = game.vehicles.createVehicle(
				'wheelbarrow',
				{
					q: 1,
					r: 0,
				},
				[line]
			)
			const worker = game.population.createCharacter('Worker', { q: 1, r: 0 })
			const proposedJobsSpy = vi.spyOn(vehicle, 'proposedJobs', 'get')

			expect(worker.resolveBestJobMatch()).toBeTruthy()
			expect(proposedJobsSpy).not.toHaveBeenCalled()
		} finally {
			vi.restoreAllMocks()
			game.destroy()
		}
	})

	it('exposes a faithful WorkAdvertisement view on tiles (Phase 3 first increment)', async () => {
		const engine = new TestEngine({ terrainSeed: 42_105, characterCount: 0 })
		await engine.init()

		try {
			engine.loadScenario({
				hives: [
					{
						name: 'AdHive',
						alveoli: [{ coord: [2, 2], alveolus: 'sawmill', goods: { wood: 6 } }],
					},
				],
			})
			const tile = engine.game.hex.getTile({ q: 2, r: 2 })!
			const jobs = tile.proposedJobs
			const ads = tile.workAdvertisements

			expect(ads).toHaveLength(jobs.length)
			for (let i = 0; i < jobs.length; i++) {
				const job = jobs[i]!
				const ad = ads[i]!
				expect(ad.kind).toBe(job.job)
				expect(ad.urgency).toBe(job.urgency)
				expect(ad.targetTile).toBe(job.targetTile)
				expect(ad.source).toBe(job.source)
			}
		} finally {
			await engine.destroy()
		}
	})

	it('keeps a stable targetTile reference across a work-planning bump (Phase 4 commitment)', async () => {
		const engine = new TestEngine({ terrainSeed: 42_106, characterCount: 0 })
		await engine.init()

		try {
			engine.loadScenario({
				hives: [
					{
						name: 'StableHive',
						alveoli: [{ coord: [3, 3], alveolus: 'sawmill', goods: { wood: 4 } }],
					},
				],
			})
			const alveolus = engine.game.hex.getTile({ q: 3, r: 3 })!.content as Alveolus
			const before = alveolus.proposedJobs[0]!.targetTile

			// Bump work planning (recreates the job objects via the Derived cache).
			engine.game.invalidateWorkPlanning('test-bump')
			const after = alveolus.proposedJobs[0]!.targetTile

			// The `Job` object is recreated, but the target tile is a stable reference.
			expect(after).toBe(before)
			expect(after).toBe(alveolus.tile)
		} finally {
			await engine.destroy()
		}
	})
})
