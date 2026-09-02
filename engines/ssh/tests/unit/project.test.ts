import { isConstructionSiteShell } from 'ssh/build-site'
import { Game } from 'ssh/game/game'
import type { HivePlan, HivePlanEntry } from 'ssh/hive-plan'
import { hivePlanFingerprint } from 'ssh/hive-plan'
import {
	groupRoadsByConnectedType,
	projectFingerprint,
	ProjectCollection,
	projectValidationRequirements,
	stampHivePlanEntries,
	validateProjectStructure,
} from 'ssh/project'
import { describe, expect, it } from 'vitest'

const mockGame = () =>
	({
		configurationManager: {
			getNamedConfiguration() {
				return undefined
			},
		},
		hivePlans: { plans: [] },
		invalidateWorkPlanning() {},
	}) as any

const entry = (
	q: number,
	r: number,
	alveolusType: HivePlanEntry['alveolusType'] = 'storage'
): HivePlanEntry => ({
	coord: [q, r],
	alveolusType,
})

const template = (name: string, entries: HivePlanEntry[]): HivePlan => ({
	name,
	entries,
	knownnessFingerprint: hivePlanFingerprint(entries),
})

describe('projects (placed alveoli + roads)', () => {
	it('bills absolute entries identically to templates', () => {
		const bill = projectValidationRequirements([entry(5, 5), entry(6, 5)], [])
		expect(bill.requiredGoods).toEqual({ concrete: 2, wood: 4, planks: 20 })
	})

	it('fingerprints position-independently', () => {
		const a = projectFingerprint([entry(0, 0), entry(1, 0)])
		const b = projectFingerprint([entry(10, 10), entry(11, 10)])
		expect(a).toBe(b)
	})

	it('stamps a template into absolute entries', () => {
		const stamped = stampHivePlanEntries(
			template('T', [entry(0, 0), entry(1, 0)]),
			{ q: 5, r: -2 },
			0,
			false
		)
		expect(stamped.map((entry) => entry.coord)).toEqual([
			[5, -2],
			[6, -2],
		])
	})

	it('mirrors a template when stamping', () => {
		const stamped = stampHivePlanEntries(template('T', [entry(0, 0), entry(1, 0)]), { q: 0, r: 0 }, 0, true)
		// mirror (q,r) → (r,q): (0,0) → (0,0), (1,0) → (0,1)
		expect(stamped.map((entry) => entry.coord)).toEqual([
			[0, 0],
			[0, 1],
		])
	})

	it('dedupes projects with the same relative layout at different positions', () => {
		const collection = new ProjectCollection(mockGame())
		const a = collection.createDraft('A', [entry(0, 0), entry(1, 0)])
		const b = collection.createDraft('B', [entry(5, 5), entry(6, 5)])

		expect(b).toBe(a)
		expect(collection.projects).toHaveLength(1)
	})

	it('creates empty projects without deduplicating them', () => {
		const collection = new ProjectCollection(mockGame())
		const a = collection.createDraft('A', [])
		const b = collection.createDraft('B', [])

		expect(a).not.toBe(b)
		expect(collection.draftProjects).toEqual([a, b])
	})

	it('validates project structure', () => {
		expect(validateProjectStructure(mockGame(), []).map((issue) => issue.code)).toContain('empty')
		expect(
			validateProjectStructure(mockGame(), [entry(0, 0), entry(3, 0)]).map((issue) => issue.code)
		).toContain('disconnected')
	})

	it('groups roads into same-type connected components', () => {
		// A path road along r=0 borders (tiles (0,0)-(1,0) and (1,0)-(2,0)):
		// midpoints (0.5, 0) and (1.5, 0) share the tile (1,0) → one group.
		const connected = groupRoadsByConnectedType([
			{ coord: [0.5, 0], type: 'path' },
			{ coord: [1.5, 0], type: 'path' },
		])
		expect(connected).toHaveLength(1)
		expect(connected[0].type).toBe('path')
		expect(connected[0].coords).toHaveLength(2)

		// Two disjoint path segments → two groups.
		const disjoint = groupRoadsByConnectedType([
			{ coord: [0.5, 0], type: 'path' },
			{ coord: [10.5, 0], type: 'path' },
		])
		expect(disjoint).toHaveLength(2)

		// Same shape but different type → separate groups.
		const byType = groupRoadsByConnectedType([
			{ coord: [0.5, 0], type: 'path' },
			{ coord: [1.5, 0], type: 'asphalt' },
		])
		expect(byType).toHaveLength(2)
	})

	it('connects roads meeting at a shared tile across the q=r diagonal', () => {
		// Diagonal border (0.5, 0.5) connects tiles (0,1) and (1,0); a horizontal border
		// (0.5, 1) connects (0,1) and (1,1). Shared tile (0,1) joins them.
		const groups = groupRoadsByConnectedType([
			{ coord: [0.5, 0.5], type: 'asphalt' },
			{ coord: [0.5, 1], type: 'asphalt' },
		])
		expect(groups).toHaveLength(1)
		expect(groups[0].coords).toHaveLength(2)
	})

	it('commits a draft project into working (freeze only, no board)', () => {
		const collection = new ProjectCollection(mockGame())
		const project = collection.createDraft('Storage Pair', [entry(0, 0), entry(1, 0)])

		const result = collection.commit(project)

		expect(result.ok).toBe(true)
		expect(project.stage).toBe('working')
		expect(collection.workingProjects).toEqual([project])
	})

	it('refuses to commit an empty project', () => {
		const collection = new ProjectCollection(mockGame())
		const project = collection.createDraft('Empty', [])

		const result = collection.commit(project)

		expect(result.ok).toBe(false)
		expect(project.stage).toBe('draft')
	})

	it('materializes entries as construction shells and applies roads', async () => {
		const game = new Game(
			{ terrainSeed: 7, characterCount: 0, settlementGeneration: false },
			{
				terrains: {
					grass: [
						[0, 0],
						[1, 0],
						[0, 1],
						[0, 2],
					],
				},
			}
		)
		await game.loaded
		game.ticker.stop()
		try {
			const project = game.projects.createDraft('Pair', [entry(0, 0), entry(1, 0)])
			// Road on the border between (0,1) and (0,2): axial midpoint (0, 1.5).
			project.roads = [{ coord: [0, 1.5], type: 'path' }]

			const result = game.commitProject(project)

			expect(result.ok).toBe(true)
			expect(project.stage).toBe('working')

			const shell = game.hex.getTile({ q: 0, r: 0 })?.content
			expect(isConstructionSiteShell(shell)).toBe(true)
			expect((shell as { project?: unknown }).project).toBe(project)

			expect(game.hex.getRoadType({ q: 0, r: 1.5 })).toBe('path')
		} finally {
			game.destroy()
		}
	})

	it('refuses to commit an archived project', async () => {
		const game = new Game(
			{ terrainSeed: 8, characterCount: 0, settlementGeneration: false },
			{
				terrains: { grass: [[0, 0]] },
			}
		)
		await game.loaded
		game.ticker.stop()
		try {
			const project = game.projects.createDraft('Draft', [entry(0, 0)])
			game.projects.archive(project)

			const result = game.commitProject(project)

			expect(result.ok).toBe(false)
			expect(project.stage).toBe('archived')
		} finally {
			game.destroy()
		}
	})

	it('refuses to commit onto an occupied tile', async () => {
		const game = new Game(
			{ terrainSeed: 9, characterCount: 0, settlementGeneration: false },
			{
				terrains: { grass: [[0, 0]] },
				hives: [{ name: 'Occ', alveoli: [{ coord: [0, 0] as const, alveolus: 'storage' as const }] }],
			}
		)
		await game.loaded
		game.ticker.stop()
		try {
			const project = game.projects.createDraft('Blocked', [entry(0, 0)])

			const result = game.commitProject(project)

			expect(result.ok).toBe(false)
			expect(project.stage).toBe('draft')
		} finally {
			game.destroy()
		}
	})
})
