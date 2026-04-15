import {
	type FreightLineDefinition,
	distributeSegmentAllowsGoodType,
	distributeSegmentAllowsGoodTypeForSegment,
	distributeSegmentWithinRadius,
	findDistributeFreightLines,
	findDistributeRouteSegments,
	findGatherFreightLine,
	findGatherFreightLines,
	findGatherRouteSegments,
	freightLineAllowsGoodType,
	freightLineSummary,
	gatherSegmentAllowsGoodType,
	normalizeFreightLineDefinition,
} from 'ssh/freight/freight-line'
import type { SaveState } from 'ssh/game'
import { StorageAlveolus } from 'ssh/hive/storage'
import { describe, expect, it } from 'vitest'
import { distributeFreightLine, gatherFreightLine } from '../freight-fixtures'
import { TestEngine } from '../test-engine'

const H00 = {
	kind: 'alveolus' as const,
	hiveName: 'H',
	alveolusType: 'freight_bay' as const,
	coord: [0, 0] as const,
}

describe('Freight bay multi-line', () => {
	it('exposes all gather and distribute lines for the same stop', () => {
		const stop = {
			hive: { name: 'H' },
			name: 'freight_bay',
			tile: { position: { q: 0, r: 0 } },
		}
		const lines = [
			gatherFreightLine({
				id: 'H:gather-a',
				name: 'Gather A',
				hiveName: 'H',
				coord: [0, 0],
				filters: ['wood'],
				radius: 2,
			}),
			gatherFreightLine({
				id: 'H:gather-b',
				name: 'Gather B',
				hiveName: 'H',
				coord: [0, 0],
				filters: ['berries'],
				radius: 3,
			}),
			distributeFreightLine({
				id: 'H:dist-a',
				name: 'Distribute A',
				hiveName: 'H',
				coord: [0, 0],
				filters: ['wood'],
			}),
			distributeFreightLine({
				id: 'H:dist-b',
				name: 'Distribute B',
				hiveName: 'H',
				coord: [0, 0],
				filters: ['berries'],
			}),
		]
		expect(
			findGatherFreightLines(lines, stop)
				.map((l) => l.id)
				.sort()
		).toEqual(['H:gather-a', 'H:gather-b'])
		expect(
			findDistributeFreightLines(lines, stop)
				.map((l) => l.id)
				.sort()
		).toEqual(['H:dist-a', 'H:dist-b'])
		expect(findGatherFreightLine(lines, stop)?.id).toBe('H:gather-a')
	})

	it('advertises provide for stock allowed by any gather line and any distribute line', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'MultiBayHive',
						alveoli: [{ coord: [0, 0], alveolus: 'gather', goods: { wood: 2 } }],
					},
				],
				freightLines: [
					gatherFreightLine({
						id: 'Multi:gather-wood',
						name: 'Gather wood',
						hiveName: 'MultiBayHive',
						coord: [0, 0],
						filters: ['wood'],
						radius: 2,
					}),
					gatherFreightLine({
						id: 'Multi:gather-berries',
						name: 'Gather berries',
						hiveName: 'MultiBayHive',
						coord: [0, 0],
						filters: ['berries'],
						radius: 2,
					}),
					distributeFreightLine({
						id: 'Multi:dist-wood',
						name: 'Distribute wood',
						hiveName: 'MultiBayHive',
						coord: [0, 0],
						filters: ['wood'],
					}),
					distributeFreightLine({
						id: 'Multi:dist-berries',
						name: 'Distribute berries',
						hiveName: 'MultiBayHive',
						coord: [0, 0],
						filters: ['berries'],
					}),
				],
			}
			engine.loadScenario(scenario)
			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content
			expect(bay).toBeInstanceOf(StorageAlveolus)
			const rel = (bay as StorageAlveolus).workingGoodsRelations
			expect(rel.wood?.advertisement).toBe('provide')
			expect(rel.berries).toBeUndefined()
		} finally {
			await engine.destroy()
		}
	})

	it('picks a gather line id when several gather lines share the bay', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'PickHive',
						alveoli: [{ coord: [0, 0], alveolus: 'gather', goods: {} }],
					},
				],
				looseGoods: [{ goodType: 'wood', position: { q: 0, r: 2 } }],
				freightLines: [
					gatherFreightLine({
						id: 'PickHive:gather-wood',
						name: 'Gather wood',
						hiveName: 'PickHive',
						coord: [0, 0],
						filters: ['wood'],
						radius: 4,
					}),
					gatherFreightLine({
						id: 'PickHive:gather-berries',
						name: 'Gather berries',
						hiveName: 'PickHive',
						coord: [0, 0],
						filters: ['berries'],
						radius: 4,
					}),
				],
			}
			engine.loadScenario(scenario)
			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content
			expect(bay).toBeInstanceOf(StorageAlveolus)
			const job = (bay as StorageAlveolus).nextJob()
			expect(job?.job).toBe('gather')
			if (job?.job === 'gather') {
				expect(job.lineId).toBe('PickHive:gather-wood')
				expect(job.goodType).toBe('wood')
			}
		} finally {
			await engine.destroy()
		}
	})

	it('segment-specific goods checks isolate gather from distribute', () => {
		const woodPolicy = {
			goodRules: [{ goodType: 'wood' as const, effect: 'allow' as const }],
			tagRules: [],
			defaultEffect: 'deny' as const,
		}
		const planksPolicy = {
			goodRules: [{ goodType: 'planks' as const, effect: 'allow' as const }],
			tagRules: [],
			defaultEffect: 'deny' as const,
		}
		const line: FreightLineDefinition = normalizeFreightLineDefinition({
			id: 'mixed',
			name: 'Mixed line',
			stops: [
				{
					id: 'gather-load',
					loadSelection: woodPolicy,
					zone: { kind: 'radius', center: [0, 0], radius: 3 },
				},
				{ id: 'gather-unload', anchor: H00 },
				{ id: 'dist-load', loadSelection: planksPolicy, anchor: H00 },
				{ id: 'dist-unload', anchor: H00 },
			],
		})

		expect(gatherSegmentAllowsGoodType(line, 'wood')).toBe(true)
		expect(gatherSegmentAllowsGoodType(line, 'planks')).toBe(false)
		expect(distributeSegmentAllowsGoodType(line, 'planks')).toBe(true)
		expect(distributeSegmentAllowsGoodType(line, 'wood')).toBe(false)
		expect(freightLineAllowsGoodType(line, 'wood')).toBe(true)
		expect(freightLineAllowsGoodType(line, 'planks')).toBe(true)
		expect(freightLineSummary(line)).toBe('Gather + distribute')
	})

	it('detects multiple distribute segments on one line', () => {
		const woodPol = {
			goodRules: [{ goodType: 'wood' as const, effect: 'allow' as const }],
			tagRules: [],
			defaultEffect: 'deny' as const,
		}
		const planksPol = {
			goodRules: [{ goodType: 'planks' as const, effect: 'allow' as const }],
			tagRules: [],
			defaultEffect: 'deny' as const,
		}
		const line: FreightLineDefinition = normalizeFreightLineDefinition({
			id: 'two-dist',
			name: 'Two distributes',
			stops: [
				{
					id: 'dist-a-load',
					loadSelection: woodPol,
					anchor: { kind: 'alveolus', hiveName: 'H', alveolusType: 'freight_bay', coord: [0, 0] },
				},
				{
					id: 'dist-a-unload',
					zone: { kind: 'radius', center: [1, 0], radius: 4 },
				},
				{
					id: 'dist-b-load',
					loadSelection: planksPol,
					anchor: { kind: 'alveolus', hiveName: 'H', alveolusType: 'freight_bay', coord: [2, 0] },
				},
				{
					id: 'dist-b-unload',
					zone: { kind: 'radius', center: [3, 0], radius: 2 },
				},
			],
		})

		const segments = findDistributeRouteSegments(line)
		expect(segments).toHaveLength(2)
		expect(findGatherRouteSegments(line)).toHaveLength(0)

		expect(distributeSegmentAllowsGoodType(line, 'wood')).toBe(true)
		expect(distributeSegmentAllowsGoodType(line, 'planks')).toBe(true)
		expect(distributeSegmentAllowsGoodType(line, 'berries')).toBe(false)

		expect(distributeSegmentWithinRadius(line, segments[0]!, 3)).toBe(true)
		expect(distributeSegmentWithinRadius(line, segments[0]!, 5)).toBe(false)
		expect(distributeSegmentWithinRadius(line, segments[1]!, 2)).toBe(true)
		expect(distributeSegmentWithinRadius(line, segments[1]!, 3)).toBe(false)

		expect(distributeSegmentAllowsGoodTypeForSegment(line, segments[0]!, 'wood')).toBe(true)
		expect(distributeSegmentAllowsGoodTypeForSegment(line, segments[0]!, 'planks')).toBe(false)
		expect(distributeSegmentAllowsGoodTypeForSegment(line, segments[1]!, 'planks')).toBe(true)
		expect(distributeSegmentAllowsGoodTypeForSegment(line, segments[1]!, 'wood')).toBe(false)
	})

	it('detects multiple gather segments on one line', () => {
		const woodPol = {
			goodRules: [{ goodType: 'wood' as const, effect: 'allow' as const }],
			tagRules: [],
			defaultEffect: 'deny' as const,
		}
		const berriesPol = {
			goodRules: [{ goodType: 'berries' as const, effect: 'allow' as const }],
			tagRules: [],
			defaultEffect: 'deny' as const,
		}
		const line: FreightLineDefinition = normalizeFreightLineDefinition({
			id: 'two-gather',
			name: 'Two gathers',
			stops: [
				{
					id: 'g-a-load',
					loadSelection: woodPol,
					zone: { kind: 'radius', center: [0, 0], radius: 5 },
				},
				{
					id: 'g-a-unload',
					anchor: { kind: 'alveolus', hiveName: 'H', alveolusType: 'freight_bay', coord: [0, 0] },
				},
				{
					id: 'g-b-load',
					loadSelection: berriesPol,
					zone: { kind: 'radius', center: [1, 0], radius: 3 },
				},
				{
					id: 'g-b-unload',
					anchor: { kind: 'alveolus', hiveName: 'H', alveolusType: 'freight_bay', coord: [1, 0] },
				},
			],
		})

		const segments = findGatherRouteSegments(line)
		expect(segments).toHaveLength(2)
		expect(findDistributeRouteSegments(line)).toHaveLength(0)

		expect(gatherSegmentAllowsGoodType(line, 'wood')).toBe(true)
		expect(gatherSegmentAllowsGoodType(line, 'berries')).toBe(true)
		expect(gatherSegmentAllowsGoodType(line, 'planks')).toBe(false)
	})

	it('road-fret canTake allows goods accepted by a distribute line when gather lines exist', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'TakeHive',
						alveoli: [{ coord: [0, 0], alveolus: 'gather', goods: {} }],
					},
				],
				freightLines: [
					gatherFreightLine({
						id: 'TakeHive:gather',
						name: 'Gather',
						hiveName: 'TakeHive',
						coord: [0, 0],
						filters: ['wood'],
						radius: 2,
					}),
					distributeFreightLine({
						id: 'TakeHive:distribute',
						name: 'Distribute',
						hiveName: 'TakeHive',
						coord: [0, 0],
						filters: ['wood'],
					}),
				],
			}
			engine.loadScenario(scenario)
			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content
			expect(bay).toBeInstanceOf(StorageAlveolus)
			const storage = bay as StorageAlveolus
			expect(storage.canTake('wood', '1-buffer')).toBe(true)
			expect(storage.canTake('berries', '1-buffer')).toBe(false)
		} finally {
			await engine.destroy()
		}
	})
})
