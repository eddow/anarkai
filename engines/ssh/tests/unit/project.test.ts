import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { isConstructionSiteShell } from 'ssh/build-site'
import { demolishStructure } from 'ssh/construction-demolition'
import { Game } from 'ssh/game/game'
import type { HivePlan, HivePlanEntry } from 'ssh/hive-plan'
import { hivePlanCenterOffset, hivePlanFingerprint, rotateHivePlanCoord } from 'ssh/hive-plan'
import {
	groupProjectEntriesIntoHives,
	groupRoadsByConnectedType,
	ProjectCollection,
	projectFingerprint,
	projectSourcingMode,
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
		emit() {},
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
		const stamped = stampHivePlanEntries(
			template('T', [entry(0, 0), entry(1, 0)]),
			{ q: 0, r: 0 },
			0,
			true
		)
		// mirror (q,r) → (r,q): (0,0) → (0,0), (1,0) → (0,1)
		expect(stamped.map((entry) => entry.coord)).toEqual([
			[0, 0],
			[0, 1],
		])
	})

	it('normalizes a plan authored far from origin to its centroid when stamped', () => {
		// Template authored at absolute-ish relative coords (5,5)/(6,5): centroid → (5,5).
		const center = hivePlanCenterOffset([entry(5, 5), entry(6, 5)], 0, false)
		expect(center).toEqual({ q: 5, r: 5 })

		const stamped = stampHivePlanEntries(
			template('T', [entry(5, 5), entry(6, 5)]),
			{ q: 0, r: 0 },
			0,
			false
		)
		expect(stamped.map((entry) => entry.coord)).toEqual([
			[0, 0],
			[1, 0],
		])
	})

	it('computes a single-tile centroid at the origin', () => {
		expect(hivePlanCenterOffset([entry(0, 0)], 0, false)).toEqual({ q: 0, r: 0 })
		expect(hivePlanCenterOffset([], 0, false)).toEqual({ q: 0, r: 0 })
	})

	it('keeps the centroid handle stable under rotation (rotation-equivariant)', () => {
		const entries = [entry(0, 0), entry(1, 0), entry(0, 1)]
		const base = hivePlanCenterOffset(entries, 0, false)
		for (let rotation = 0; rotation < 6; rotation++) {
			// Rounding happens once on the base shape, so the rotated handle is the
			// exact rotation of the base handle (no re-rounding drift).
			expect(hivePlanCenterOffset(entries, rotation, false)).toEqual(
				rotateHivePlanCoord([base.q, base.r], rotation)
			)
		}
	})

	it('keeps the centroid handle stable under mirror', () => {
		const entries = [entry(0, 0), entry(2, 0), entry(0, 1)]
		const base = hivePlanCenterOffset(entries, 0, false)
		// mirror (q,r) → (r,q): the rounded base centroid mirrors exactly.
		expect(hivePlanCenterOffset(entries, 0, true)).toEqual({ q: base.r, r: base.q })
	})

	it('dedupes projects with the same relative layout at different positions', () => {
		const collection = new ProjectCollection(mockGame())
		const a = collection.createDraft('A', [entry(0, 0), entry(1, 0)])
		const b = collection.createDraft('B', [entry(5, 5), entry(6, 5)])

		expect(b.project).toBe(a.project)
		expect(b.duplicate).toBe(a.project)
		expect(collection.projects).toHaveLength(1)
	})

	it('creates empty projects without deduplicating them', () => {
		const collection = new ProjectCollection(mockGame())
		const a = collection.createDraft('A', [])
		const b = collection.createDraft('B', [])

		expect(a.project).not.toBe(b.project)
		expect(collection.draftProjects).toEqual([a.project, b.project])
	})

	it('tracks demolition todos and round-trips them through serialization', () => {
		const collection = new ProjectCollection(mockGame())
		const { project } = collection.createDraft('A', [entry(0, 0)])

		collection.updateDraft(project, {
			demolitions: [
				[2, 3],
				[4, 5],
			],
		})
		expect(project.demolitions).toEqual([
			[2, 3],
			[4, 5],
		])

		const serialized = collection.serialize()
		expect(serialized[0].demolitions).toEqual([
			[2, 3],
			[4, 5],
		])

		const restored = new ProjectCollection(mockGame())
		restored.deserialize(serialized)
		expect(restored.projects[0].demolitions).toEqual([
			[2, 3],
			[4, 5],
		])
	})

	it('tracks road demolition todos and removes completed ones', () => {
		const collection = new ProjectCollection(mockGame())
		const { project } = collection.createDraft('A', [entry(0, 0)])

		collection.updateDraft(project, {
			demolitions: [[2, 3]],
			roadDemolitions: [{ coord: [0, 1.5], type: 'path' }],
		})
		expect(project.roadDemolitions).toEqual([{ coord: [0, 1.5], type: 'path' }])

		const serialized = collection.serialize()
		const restored = new ProjectCollection(mockGame())
		restored.deserialize(serialized)
		expect(restored.projects[0].roadDemolitions).toEqual([{ coord: [0, 1.5], type: 'path' }])

		expect(collection.removeRoadDemolition(project, [0, 1.5])).toBe(true)
		expect(project.roadDemolitions).toEqual([])
		expect(collection.removeRoadDemolition(project, [0, 1.5])).toBe(false)

		expect(collection.removeDemolition(project, [2, 3])).toBe(true)
		expect(project.demolitions).toEqual([])
		expect(collection.removeDemolition(project, [2, 3])).toBe(false)
	})

	it('tracks per-good take/buy sourcing overrides and round-trips them', () => {
		const collection = new ProjectCollection(mockGame())
		const { project } = collection.createDraft('A', [entry(0, 0)])

		// No override by default.
		expect(projectSourcingMode(project, 'stone')).toBeUndefined()
		expect(projectSourcingMode(undefined, 'stone')).toBeUndefined()

		// Per-good override.
		collection.setSourcingMode(project, 'stone', 'buy')
		collection.setSourcingMode(project, 'wood', 'take')
		expect(projectSourcingMode(project, 'stone')).toBe('buy')
		expect(projectSourcingMode(project, 'wood')).toBe('take')

		// Clearing an override restores `undefined`.
		collection.setSourcingMode(project, 'stone', undefined)
		expect(projectSourcingMode(project, 'stone')).toBeUndefined()

		// Wholesale replace (take-all / buy-all).
		collection.setSourcing(project, { wood: 'buy', planks: 'take' })
		expect(projectSourcingMode(project, 'wood')).toBe('buy')
		expect(projectSourcingMode(project, 'planks')).toBe('take')

		const restored = new ProjectCollection(mockGame())
		restored.deserialize(collection.serialize())
		expect(restored.projects[0].sourcing).toEqual({ wood: 'buy', planks: 'take' })
		expect(projectSourcingMode(restored.projects[0], 'wood')).toBe('buy')
		expect(projectSourcingMode(restored.projects[0], 'planks')).toBe('take')
	})

	it('validates project structure', () => {
		expect(validateProjectStructure(mockGame(), []).map((issue) => issue.code)).toContain('empty')
		// Disconnected entries are allowed — they group into several hives after commit.
		expect(
			validateProjectStructure(mockGame(), [entry(0, 0), entry(3, 0)]).map((issue) => issue.code)
		).not.toContain('disconnected')
	})

	it('groups placed alveoli into hives by adjacency', () => {
		// One contiguous cluster: (0,0) + (1,0) + (1,-1).
		const single = groupProjectEntriesIntoHives([entry(0, 0), entry(1, 0), entry(1, -1)])
		expect(single).toHaveLength(1)
		expect(single[0].index).toBe(1)
		expect(single[0].entries).toHaveLength(3)

		// Two disjoint clusters → two hives.
		const split = groupProjectEntriesIntoHives([
			entry(0, 0),
			entry(1, 0),
			entry(10, 10),
			entry(11, 10),
		])
		expect(split).toHaveLength(2)
		expect(split[0].entries).toHaveLength(2)
		expect(split[1].entries).toHaveLength(2)
		expect(split[0].index).toBe(1)
		expect(split[1].index).toBe(2)

		// Every entry is grouped exactly once.
		const all = [...split[0].entries, ...split[1].entries]
		expect(all).toHaveLength(4)
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
		const { project } = collection.createDraft('Storage Pair', [entry(0, 0), entry(1, 0)])

		const result = collection.commit(project)

		expect(result.ok).toBe(true)
		expect(project.stage).toBe('working')
		expect(collection.workingProjects).toEqual([project])
	})

	it('commits disconnected entries as a multi-hive project', () => {
		const collection = new ProjectCollection(mockGame())
		const { project } = collection.createDraft('Split', [entry(0, 0), entry(3, 0)])

		const result = collection.commit(project)

		expect(result.ok).toBe(true)
		expect(project.stage).toBe('working')
	})

	it('commits a draft even when it shares a cell with a working project (no cross-plan check)', () => {
		const collection = new ProjectCollection(mockGame())
		const { project: first } = collection.createDraft('First', [entry(0, 0), entry(1, 0)])
		expect(collection.commit(first).ok).toBe(true)

		const { project: second } = collection.createDraft('Second', [entry(5, 5)])
		// Same tile as `first` but a different layout so dedup does not merge them.
		second.entries = [entry(0, 0)]
		// Plans never cross-check each other: the direct collection commit has no
		// board, so nothing here refuses the overlap. Board occupancy (which would
		// catch `first`'s materialized shell) is enforced in `Game.commitProject`,
		// not in `ProjectCollection.commit`.
		const result = collection.commit(second)

		expect(result.ok).toBe(true)
		expect(second.stage).toBe('working')
	})

	it('refuses to commit an empty project', () => {
		const collection = new ProjectCollection(mockGame())
		const { project } = collection.createDraft('Empty', [])

		const result = collection.commit(project)

		expect(result.ok).toBe(false)
		expect(project.stage).toBe('draft')
	})

	it('materializes entries as construction sites and defers roads to road engineers', async () => {
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
			const { project } = game.projects.createDraft('Pair', [entry(0, 0), entry(1, 0)])
			// Road on the border between (0,1) and (0,2): axial midpoint (0, 1.5).
			project.roads = [{ coord: [0, 1.5], type: 'path' }]

			const result = game.commitProject(project)

			expect(result.ok).toBe(true)
			expect(project.stage).toBe('working')

			const shell = game.hex.getTile({ q: 0, r: 0 })?.content
			// Commit materializes the old "construction order": an UnBuiltLand site
			// (clearing → foundation → shell), not an instant shell.
			expect(shell).toBeInstanceOf(UnBuiltLand)
			expect((shell as UnBuiltLand).site).toBe('build:storage')
			expect((shell as { project?: unknown }).project).toBe(project)
			expect(game.projectProgress(project).items[0]?.state).toBe('building')

			// Roads are built over time by road engineers, not applied at commit.
			expect(game.hex.getRoadType({ q: 0, r: 1.5 })).toBeUndefined()
			expect(project.roads).toEqual([{ coord: [0, 1.5], type: 'path' }])

			// Marking the built segment complete keeps it listed (stable progress total).
			expect(game.projects.removeRoad(project, [0, 1.5])).toBe(true)
			expect(project.roads).toEqual([{ coord: [0, 1.5], type: 'path' }])
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
			const { project } = game.projects.createDraft('Draft', [entry(0, 0)])
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
				hives: [
					{ name: 'Occ', alveoli: [{ coord: [0, 0] as const, alveolus: 'storage' as const }] },
				],
			}
		)
		await game.loaded
		game.ticker.stop()
		try {
			const { project } = game.projects.createDraft('Blocked', [entry(0, 0)])

			const result = game.commitProject(project)

			expect(result.ok).toBe(false)
			expect(project.stage).toBe('draft')
		} finally {
			game.destroy()
		}
	})

	it('defers an entry on a demolition tile until the structure is bulldozed', async () => {
		const game = new Game(
			{ terrainSeed: 10, characterCount: 0, settlementGeneration: false },
			{
				terrains: { grass: [[0, 0]] },
				hives: [
					{ name: 'Occ', alveoli: [{ coord: [0, 0] as const, alveolus: 'storage' as const }] },
				],
			}
		)
		await game.loaded
		game.ticker.stop()
		try {
			const { project } = game.projects.createDraft('Rebuild', [entry(0, 0)])
			game.projects.updateDraft(project, { demolitions: [[0, 0]] })

			const result = game.commitProject(project)
			expect(result.ok).toBe(true)
			expect(project.stage).toBe('working')

			// Entry is deferred: the existing structure is still there, not a site.
			const tile = game.hex.getTile({ q: 0, r: 0 })!
			expect(tile.content).not.toBeInstanceOf(UnBuiltLand)

			// Bulldoze → tile is clear; the deferred entry can now materialize as a site.
			demolishStructure(tile)
			game.materializeDeferredEntriesAt({ q: 0, r: 0 })

			const shell = game.hex.getTile({ q: 0, r: 0 })!.content
			expect(shell).toBeInstanceOf(UnBuiltLand)
			expect((shell as UnBuiltLand).site).toBe('build:storage')
			expect((shell as { project?: unknown }).project).toBe(project)
		} finally {
			game.destroy()
		}
	})

	it('reports a foreign alveolus as pending, not done', async () => {
		const game = new Game(
			{ terrainSeed: 12, characterCount: 0, settlementGeneration: false },
			{
				terrains: { grass: [[0, 0]] },
				hives: [
					{ name: 'Occ', alveoli: [{ coord: [0, 0] as const, alveolus: 'storage' as const }] },
				],
			}
		)
		await game.loaded
		game.ticker.stop()
		try {
			// A pile planned where a storage already stands: not done.
			const { project } = game.projects.createDraft('Mismatch', [
				{ coord: [0, 0], alveolusType: 'pile' },
			])
			const progress = game.projectProgress(project)
			expect(progress.items[0]?.state).toBe('pending')
		} finally {
			game.destroy()
		}
	})

	it('refuses to commit a project that overlaps a working project', async () => {
		const game = new Game(
			{ terrainSeed: 11, characterCount: 0, settlementGeneration: false },
			{
				terrains: {
					grass: [
						[0, 0],
						[1, 0],
					],
				},
			}
		)
		await game.loaded
		game.ticker.stop()
		try {
			// Different entry sets (so no dedup), but both claim tile (0,0).
			const { project: first } = game.projects.createDraft('First', [entry(0, 0), entry(1, 0)])
			expect(game.commitProject(first).ok).toBe(true)

			const { project: second } = game.projects.createDraft('Second', [entry(0, 0)])
			const result = game.commitProject(second)

			expect(result.ok).toBe(false)
			expect(second.stage).toBe('draft')
			// Board occupancy rejects this (the tile already hosts `first`'s
			// materialized site), not a cross-plan conflict check.
			expect(result.ok === false && result.issues).toHaveLength(1)
		} finally {
			game.destroy()
		}
	})
})
