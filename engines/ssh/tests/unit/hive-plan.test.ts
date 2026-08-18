import { isConstructionSiteShell } from 'ssh/build-site'
import { Game } from 'ssh/game/game'
import {
	applyHivePlanToolAction,
	type HivePlan,
	HivePlanCollection,
	type HivePlanEntry,
	hivePlanEntryAt,
	hivePlanFingerprint,
	hivePlanNoveltyCost,
	hivePlanVisibleCandidateCoords,
	validateHivePlanStructure,
} from 'ssh/hive-plan'
import { describe, expect, it } from 'vitest'

const mockGame = () =>
	({
		configurationManager: {
			getNamedConfiguration() {
				return undefined
			},
		},
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

describe('hive plans', () => {
	it('groups plans by stage as object references', () => {
		const collection = new HivePlanCollection(mockGame())
		const plan = collection.createDraft('Storage Pair', [entry(0, 0), entry(1, 0)])
		plan.stage = 'working'

		expect(collection.workingPlans).toEqual([plan])
		expect(collection.workingPlans[0]).toBe(plan)
	})

	it('rejects disconnected layouts before validation', () => {
		const issues = validateHivePlanStructure(mockGame(), [entry(0, 0), entry(3, 0)])

		expect(issues.map((issue) => issue.code)).toContain('disconnected')
	})

	it('normalizes exact duplicates across rotations', () => {
		const original = [entry(1, 0), entry(0, 0)]
		const rotated = [entry(0, 1), entry(0, 0)]

		expect(hivePlanFingerprint(original)).toBe(hivePlanFingerprint(rotated))
	})

	it('does not create duplicate plans', () => {
		const collection = new HivePlanCollection(mockGame())
		const original = collection.createDraft('A', [entry(1, 0), entry(0, 0)])
		const duplicate = collection.createDraft('B', [entry(0, 1), entry(0, 0)])

		expect(duplicate).toBe(original)
		expect(collection.plans).toHaveLength(1)
	})

	it('returns the existing matching plan when a draft edit becomes a duplicate', () => {
		const collection = new HivePlanCollection(mockGame())
		const original = collection.createDraft('A', [entry(1, 0), entry(0, 0)])
		const draft = collection.createDraft('Draft', [])

		const result = collection.updateDraft(draft, {
			entries: [entry(0, 1), entry(0, 0)],
		})

		expect(result).toBe(original)
		expect(draft.entries).toHaveLength(0)
	})

	it('creates empty drafts immediately without treating them as duplicates', () => {
		const collection = new HivePlanCollection(mockGame())
		const a = collection.createDraft('New hive plan', [])
		const b = collection.createDraft('New hive plan 2', [])

		expect(a).not.toBe(b)
		expect(collection.draftPlans).toEqual([a, b])
		expect(validateHivePlanStructure(mockGame(), a.entries).map((issue) => issue.code)).toContain(
			'empty'
		)
	})

	it('applies build and bulldoze tool actions to draft plan cells', () => {
		const added = applyHivePlanToolAction([], 'build:storage', { q: 0, r: 0 })

		expect(added.changed).toBe(true)
		expect(added.entries).toHaveLength(1)
		expect(hivePlanEntryAt(added.entries, { q: 0, r: 0 })?.alveolusType).toBe('storage')

		const changed = applyHivePlanToolAction(added.entries, 'build:sawmill', { q: 0, r: 0 })
		expect(hivePlanEntryAt(changed.entries, { q: 0, r: 0 })?.alveolusType).toBe('sawmill')

		const removed = applyHivePlanToolAction(changed.entries, 'bulldoze', { q: 0, r: 0 })
		expect(removed.changed).toBe(true)
		expect(removed.entries).toHaveLength(0)
	})

	it('shows candidate neighbor coords for visual plan expansion', () => {
		expect(hivePlanVisibleCandidateCoords([])).toEqual([{ q: 0, r: 0 }])

		const candidates = hivePlanVisibleCandidateCoords([entry(0, 0)])
		expect(candidates).toHaveLength(6)
		expect(candidates).toEqual(
			expect.arrayContaining([
				{ q: 1, r: 0 },
				{ q: 0, r: 1 },
			])
		)
	})

	it('uses archived plans as known memory for novelty', () => {
		const collection = new HivePlanCollection(mockGame())
		const archived = collection.createDraft('Known', [entry(0, 0), entry(1, 0)])
		collection.archive(archived)

		const novelWithoutMemory = hivePlanNoveltyCost([entry(0, 0), entry(1, 0)], [])
		const novelWithMemory = hivePlanNoveltyCost(
			[entry(0, 0), entry(1, 0)],
			collection.archivedPlans
		)

		expect(novelWithMemory).toBeLessThan(novelWithoutMemory)
	})

	it('places a working plan and saves construction provenance', async () => {
		const game = new Game(
			{ terrainSeed: 123, characterCount: 0, settlementGeneration: false },
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
			const plan = game.hivePlans.createDraft('Storage Pair', [entry(0, 0), entry(1, 0)])
			plan.stage = 'working'

			expect(game.applyHivePlanPlacement(plan, { q: 0, r: 0 }, 0)).toBe(true)

			const content = game.hex.getTile({ q: 0, r: 0 })?.content
			expect(isConstructionSiteShell(content)).toBe(true)
			expect((content as { hivePlan?: HivePlan }).hivePlan).toBe(plan)

			const saved = game.saveGameData()
			expect(saved.projectSites).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						hivePlanIndex: game.hivePlans.indexOf(plan),
					}),
				])
			)
			expect(saved.hivePlans?.[0]).toMatchObject({ name: plan.name, stage: 'working' })
		} finally {
			game.destroy()
		}
	})
})
