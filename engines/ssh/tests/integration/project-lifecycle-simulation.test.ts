// @ts-nocheck
import { Alveolus } from 'ssh/board/content/alveolus'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { isConstructionSiteShell } from 'ssh/build-site'
import { RoadConstructionSite } from 'ssh/construction-road'
import type { GoodType } from 'ssh/types/base'
import { afterEach, describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

/**
 * End-to-end project lifecycle: author → commit (instant validation) → construct.
 *
 * The board is a purpose-built fixture: a production hive (pile + freight bay +
 * building & road engineers) plus a side hive (two piles) that the project tears
 * down. The project commits:
 *
 *   - one alveolus entry on an empty tile          → built alveolus
 *   - one road segment                              → built road
 *   - a demolition of a side pile                    → bulldozed alveolus
 *   - a second side pile demolished + rebuilt        → replaced alveolus
 *
 * Material delivery is preloaded into the shells directly (freight hauling is
 * covered by the dedicated freight-simulation suite); this test drives the
 * project/construction/demolition lifecycle through the ticker with real worker
 * job selection.
 */

const ENGINEER_BUILDING: [number, number] = [2, 0]
const ENGINEER_ROAD: [number, number] = [3, 0]
const ENTRY_A: [number, number] = [1, 2] // built alveolus (pile)
const SIDE_1: [number, number] = [0, 2] // bulldozed (pile)
const SIDE_2: [number, number] = [0, 3] // replaced (pile → pile)
const ROAD_BORDER: [number, number] = [2.5, 2] // between [2,2] and [3,2]

function coord(q: number, r: number): [number, number] {
	return [q, r]
}

function concreteGrid(qMin: number, qMax: number, rMin: number, rMax: number): [number, number][] {
	const tiles: [number, number][] = []
	for (let q = qMin; q <= qMax; q++) {
		for (let r = rMin; r <= rMax; r++) tiles.push([q, r])
	}
	return tiles
}

function injectGoods(content: unknown, goods: Partial<Record<GoodType, number>>): void {
	if (!content || typeof content !== 'object' || !('storage' in content)) return
	const storage = (content as { storage: { addGood(good: GoodType, qty: number): unknown } })
		.storage
	for (const [good, qty] of Object.entries(goods)) {
		storage.addGood(good as GoodType, qty ?? 0)
	}
}

/** Drive worker job selection + the ticker until `isDone` or `maxVirtualSeconds`. */
async function simulateUntil(
	engine: TestEngine,
	workers: readonly ReturnType<TestEngine['spawnCharacter']>[],
	isDone: () => boolean,
	maxVirtualSeconds: number,
	onTick?: () => void
): Promise<void> {
	const step = 0.1
	let elapsed = 0
	let i = 0
	while (elapsed < maxVirtualSeconds && !isDone()) {
		for (const worker of workers) {
			if (worker.stepExecutor) continue
			const job = worker.findBestJob()
			if (job) worker.begin(job)
		}
		engine.tick(step)
		onTick?.()
		elapsed += step
		i++
		if (i % 200 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
	}
}

describe('project lifecycle simulation', () => {
	let engine: TestEngine | undefined

	afterEach(async () => {
		await engine?.destroy()
		engine = undefined
	})

	it('builds an alveolus, builds a road, bulldozes a pile, and replaces a pile', {
		timeout: 120000,
	}, async () => {
		engine = new TestEngine({ terrainSeed: 20260903, characterCount: 0 })
		await engine.init()

		engine.loadScenario({
			terrains: { concrete: concreteGrid(-2, 4, -2, 4) },
			hives: [
				{
					name: 'Production',
					alveoli: [
						{ coord: coord(0, 0), alveolus: 'pile', goods: { wood: 12, stone: 4 } },
						{ coord: coord(1, 0), alveolus: 'freight_bay', goods: {} },
						{ coord: ENGINEER_BUILDING, alveolus: 'engineer', goods: {} },
						{ coord: ENGINEER_ROAD, alveolus: 'engineer', goods: {} },
					],
				},
				{
					name: 'ToDemolish',
					alveoli: [
						{ coord: SIDE_1, alveolus: 'pile', goods: {} },
						{ coord: SIDE_2, alveolus: 'pile', goods: {} },
					],
				},
			],
		})

		// oxc strips `variants` from engineer definitions, so the root engineer
		// provides zero jobs — inject the specs directly (as the freight suite does).
		for (const [coord, kind] of [
			[ENGINEER_BUILDING, 'building'],
			[ENGINEER_ROAD, 'road'],
		] as const) {
			const tile = engine.game.hex.getTile({ q: coord[0], r: coord[1] })
			if (tile?.content) {
				;(tile.content as Record<string, unknown> & { variantSpec?: unknown }).variantSpec = {
					kind,
				}
			}
		}

		// ── Author the project ────────────────────────────────────────────────
		const { project } = engine.game.projects.createDraft('Lifecycle', [])
		engine.game.projects.updateDraft(project, {
			entries: [
				{ coord: ENTRY_A, alveolusType: 'pile' },
				{ coord: SIDE_2, alveolusType: 'pile' },
			],
			roads: [{ coord: ROAD_BORDER, type: 'path' }],
			demolitions: [SIDE_1, SIDE_2],
		})

		// ── Commit (instant validation) ────────────────────────────────────────
		const result = engine.game.commitProject(project)
		expect(result.ok).toBe(true)
		expect(project.stage).toBe('working')

		// Entry A is materialized as a construction shell.
		const entryAShell = engine.game.hex.getTile({ q: ENTRY_A[0], r: ENTRY_A[1] })?.content
		expect(isConstructionSiteShell(entryAShell)).toBe(true)
		expect((entryAShell as { project?: unknown }).project).toBe(project)

		// The road becomes a construction site on its anchor tile [2,2].
		const roadTile = engine.game.hex.getTile({ q: 2, r: 2 })
		expect(roadTile?.content).toBeInstanceOf(RoadConstructionSite)

		// The side piles are still structures (demolition pending), entry B deferred.
		expect(engine.game.hex.getTile({ q: SIDE_2[0], r: SIDE_2[1] })?.content).toBeInstanceOf(
			Alveolus
		)

		// ── Preload materials (freight is tested separately) ───────────────────
		injectGoods(entryAShell, { wood: 4 })
		injectGoods(roadTile?.content, { stone: 1 })

		// ── Spawn workers ──────────────────────────────────────────────────────
		const workers = [
			engine.spawnCharacter('Builder', { q: 1, r: 0 }),
			engine.spawnCharacter('Roader', { q: 2, r: 1 }),
			engine.spawnCharacter('Helper', { q: 0, r: 1 }),
		]
		for (const worker of workers) {
			worker.role = 'worker'
			void worker.scriptsContext
		}

		// ── Simulate ───────────────────────────────────────────────────────────
		let entryBInjected = false
		const tileContent = (c: readonly [number, number]) =>
			engine!.game.hex.getTile({ q: c[0], r: c[1] })?.content
		const isBuiltPile = (c: readonly [number, number]) => {
			const content = tileContent(c)
			return content instanceof Alveolus && content.name === 'pile'
		}

		await simulateUntil(
			engine,
			workers,
			() =>
				isBuiltPile(ENTRY_A) &&
				engine!.game.hex.getRoadType({ q: ROAD_BORDER[0], r: ROAD_BORDER[1] }) === 'path' &&
				tileContent(SIDE_1) instanceof UnBuiltLand &&
				isBuiltPile(SIDE_2),
			180,
			() => {
				// The replaced entry (SIDE_2) materializes only after its demolition;
				// deliver its materials the moment its shell appears.
				if (entryBInjected) return
				const content = tileContent(SIDE_2)
				if (isConstructionSiteShell(content) && !(content instanceof Alveolus)) {
					injectGoods(content, { wood: 4 })
					entryBInjected = true
				}
			}
		)

		// ── Assert the four outcomes ───────────────────────────────────────────
		// 1. built alveolus
		expect(isBuiltPile(ENTRY_A)).toBe(true)
		// 2. built road
		expect(engine.game.hex.getRoadType({ q: ROAD_BORDER[0], r: ROAD_BORDER[1] })).toBe('path')
		// 3. bulldozed alveolus (structure removed, tile is empty land)
		expect(tileContent(SIDE_1)).toBeInstanceOf(UnBuiltLand)
		// 4. replaced alveolus (bulldozed, then rebuilt as a pile)
		expect(isBuiltPile(SIDE_2)).toBe(true)
	})
})
