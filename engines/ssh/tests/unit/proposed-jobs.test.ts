import { Alveolus } from 'ssh/board/content/alveolus'
import { Game } from 'ssh/game/game'
import { axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import { describe, expect, it } from 'vitest'
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
			id: 'PJ:vehicle',
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
			const vehicle = game.vehicles.createVehicle('pj-vehicle', 'wheelbarrow', { q: 1, r: 0 }, [
				line,
			])
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
})
