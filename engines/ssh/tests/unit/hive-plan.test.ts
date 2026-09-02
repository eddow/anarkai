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
	hivePlanValidationRequirements,
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

describe('hive plans (templates)', () => {
	it('registers templates without a lifecycle stage', () => {
		const collection = new HivePlanCollection(mockGame())
		const plan = collection.create('Storage Pair', [entry(0, 0), entry(1, 0)])

		expect(collection.plans).toEqual([plan])
		expect(collection.plans[0]).toBe(plan)
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

	it('does not create duplicate templates', () => {
		const collection = new HivePlanCollection(mockGame())
		const original = collection.create('A', [entry(1, 0), entry(0, 0)])
		const duplicate = collection.create('B', [entry(0, 1), entry(0, 0)])

		expect(duplicate).toBe(original)
		expect(collection.plans).toHaveLength(1)
	})

	it('returns the existing matching template when an edit becomes a duplicate', () => {
		const collection = new HivePlanCollection(mockGame())
		const original = collection.create('A', [entry(1, 0), entry(0, 0)])
		const draft = collection.create('Draft', [])

		const result = collection.update(draft, { entries: [entry(0, 1), entry(0, 0)] })

		expect(result).toBe(original)
		expect(draft.entries).toHaveLength(0)
	})

	it('creates empty templates immediately without treating them as duplicates', () => {
		const collection = new HivePlanCollection(mockGame())
		const a = collection.create('New hive plan', [])
		const b = collection.create('New hive plan 2', [])

		expect(a).not.toBe(b)
		expect(collection.plans).toEqual([a, b])
		expect(validateHivePlanStructure(mockGame(), a.entries).map((issue) => issue.code)).toContain(
			'empty'
		)
	})

	it('removes templates', () => {
		const collection = new HivePlanCollection(mockGame())
		const plan = collection.create('A', [entry(0, 0)])

		expect(collection.remove(plan)).toBe(true)
		expect(collection.plans).toHaveLength(0)
	})

	it('applies build and bulldoze tool actions to template cells', () => {
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

	it('uses registered templates as known memory for novelty', () => {
		const collection = new HivePlanCollection(mockGame())
		collection.create('Known', [entry(0, 0), entry(1, 0)])

		const novelWithoutMemory = hivePlanNoveltyCost([entry(0, 0), entry(1, 0)], [])
		const novelWithMemory = hivePlanNoveltyCost([entry(0, 0), entry(1, 0)], collection.plans)

		expect(novelWithMemory).toBeLessThan(novelWithoutMemory)
	})

	it('bills the real construction recipe (foundation + recipe) per entry', () => {
		// Test mock storage recipe is { wood: 2, planks: 10 } (see test-engine/mocks.ts);
		// plus the foundation { concrete: 1 } per tile.
		const single = hivePlanValidationRequirements([entry(0, 0)], []).requiredGoods
		expect(single).toEqual({ concrete: 1, wood: 2, planks: 10 })
	})

	it('sums the full variant ancestor chain into the bill', () => {
		// pile.wood.extra: foundation {concrete:1} + root {wood:4} + wood {wood:8}
		//                   + extra {steel:3, wood:5} → {concrete:1, wood:17, steel:3}
		const pile = (variant: string): HivePlanEntry => ({
			coord: [0, 0],
			alveolusType: 'pile',
			variant,
		})
		const bill = hivePlanValidationRequirements([pile('wood.extra')], []).requiredGoods
		expect(bill).toEqual({ concrete: 1, wood: 17, steel: 3 })
	})

	it('aggregates identical goods across multiple entries', () => {
		const bill = hivePlanValidationRequirements([entry(0, 0), entry(1, 0)], []).requiredGoods
		expect(bill).toEqual({ concrete: 2, wood: 4, planks: 20 })
	})

	it('places a template onto the board and saves construction provenance', async () => {
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
			const plan = game.hivePlans.create('Storage Pair', [entry(0, 0), entry(1, 0)])

			expect(game.applyHivePlanPlacement(plan, { q: 0, r: 0 }, 0)).toBe(true)

			const content = game.hex.getTile({ q: 0, r: 0 })?.content
			expect(isConstructionSiteShell(content)).toBe(true)
			expect((content as { hivePlan?: HivePlan }).hivePlan).toBe(plan)

			const saved = game.saveGameData()
			expect(saved.sites).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						hivePlanIndex: game.hivePlans.indexOf(plan),
					}),
				])
			)
			expect(saved.hivePlans?.[0]).toMatchObject({ name: plan.name })
		} finally {
			game.destroy()
		}
	})
})
