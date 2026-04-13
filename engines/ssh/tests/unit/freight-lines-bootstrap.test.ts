import type { SaveState } from 'ssh/game'
import {
	DEFAULT_GATHER_FREIGHT_RADIUS,
	findDistributeFreightLine,
	findGatherFreightLine,
	freightLineStationLabel,
	freightLineUid,
} from 'ssh/freight/freight-line'
import { GatherAlveolus } from 'ssh/hive/gather'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('Freight line bootstrap', () => {
	it('places gather alveolus with hive and implicit gather lines', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		const scenario: Partial<SaveState> = {
			hives: [{ name: 'H', alveoli: [{ coord: [0, 0], alveolus: 'gather', goods: {} }] }],
		}
		engine.loadScenario(scenario)
		const content = engine.game.hex.getTile({ q: 0, r: 0 })?.content
		expect(content).toBeInstanceOf(GatherAlveolus)
		const gather = content as GatherAlveolus
		expect(gather.hive).toBeDefined()
		expect(engine.game.freightLines.length).toBeGreaterThan(0)
		expect(gather.action).not.toHaveProperty('radius')
		expect(engine.game.freightLines[0]?.radius).toBe(DEFAULT_GATHER_FREIGHT_RADIUS)
		await engine.destroy()
	})

	it('planner_loop-like hive (1234) still materializes gather + woodpile', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		const scenario: Partial<SaveState> = {
			hives: [
				{
					name: 'TestHive',
					alveoli: [
						{ coord: [0, 0], alveolus: 'gather', goods: {} },
						{ coord: [1, 0], alveolus: 'woodpile', goods: {} },
					],
				},
			],
			looseGoods: [],
		}
		engine.loadScenario(scenario)
		expect(engine.game.hex.getTile({ q: 0, r: 0 })?.content).toBeInstanceOf(GatherAlveolus)
		expect(engine.game.hex.getTile({ q: 1, r: 0 })?.content).toBeDefined()
		await engine.destroy()
	})

	it('resolves a synthetic inspector object for a freight line uid', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [{ name: 'H', alveoli: [{ coord: [0, 0], alveolus: 'gather', goods: {} }] }],
			}
			engine.loadScenario(scenario)
			const line = engine.game.freightLines[0]
			expect(line).toBeDefined()
			const synthetic = line ? engine.game.getObject(freightLineUid(line.id)) : undefined
			expect(synthetic).toBeDefined()
			expect(synthetic?.uid).toBe(line ? freightLineUid(line.id) : '')
			expect(synthetic?.position).toEqual(engine.game.hex.getTile({ q: 0, r: 0 })?.position)
		} finally {
			await engine.destroy()
		}
	})

	it('uses the freight line radius as the gather authority', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'GatherRadiusHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'gather', goods: {} },
							{ coord: [1, 0], alveolus: 'sawmill', goods: {} },
						],
					},
				],
				looseGoods: [{ goodType: 'wood', position: { q: 0, r: 2 } }],
				freightLines: [
					{
						id: 'GatherRadiusHive:implicit-gather:0,0',
						name: 'Gather radius',
						mode: 'gather',
						stops: [{ hiveName: 'GatherRadiusHive', alveolusType: 'gather', coord: [0, 0] }],
						filters: ['wood'],
						radius: 1,
					},
				],
			}
			engine.loadScenario(scenario)
			const gather = engine.game.hex.getTile({ q: 0, r: 0 })?.content as GatherAlveolus
			expect(gather.hasLooseGoodsToGather).toBe(false)
			engine.game.replaceFreightLine({
				...engine.game.freightLines[0],
				radius: 2,
			})
			expect(gather.hasLooseGoodsToGather).toBe(true)
		} finally {
			await engine.destroy()
		}
	})

	it('resolves gather and distribute lines independently on the same stop', () => {
		const stop = {
			hive: { name: 'H' },
			name: 'gather',
			tile: { position: { q: 0, r: 0 } },
		}
		const lines = [
			{
				id: 'H:distribute',
				name: 'Distribute first',
				mode: 'distribute' as const,
				stops: [{ hiveName: 'H', alveolusType: 'gather' as const, coord: [0, 0] as const }],
				filters: ['wood' as const],
			},
			{
				id: 'H:gather',
				name: 'Gather second',
				mode: 'gather' as const,
				stops: [{ hiveName: 'H', alveolusType: 'gather' as const, coord: [0, 0] as const }],
				filters: ['berries' as const],
				radius: 3,
			},
		]

		expect(findGatherFreightLine(lines, stop)?.id).toBe('H:gather')
		expect(findDistributeFreightLine(lines, stop)?.id).toBe('H:distribute')
	})

	it('matches unnamed hives with their implicit gather lines', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		try {
			engine.loadScenario({
				hives: [{ alveoli: [{ coord: [0, 0], alveolus: 'gather', goods: {} }] }],
			})

			const gather = engine.game.hex.getTile({ q: 0, r: 0 })?.content as GatherAlveolus
			const implicit = findGatherFreightLine(engine.game.freightLines, gather)
			expect(implicit).toBeDefined()
			expect(implicit?.stops[0]).toMatchObject({
				hiveName: '',
				alveolusType: 'freight_bay',
				coord: [0, 0],
			})
			expect(implicit?.radius).toBe(DEFAULT_GATHER_FREIGHT_RADIUS)
		} finally {
			await engine.destroy()
		}
	})

	it('formats station labels as hive name with coordinates', () => {
		expect(freightLineStationLabel({ hiveName: 'ChopSaw', coord: [10, -8] })).toBe('ChopSaw (10, -8)')
		expect(freightLineStationLabel({ hiveName: '', coord: [0, 0] })).toBe('Hive (0, 0)')
	})

	it('round-trips edited freight line settings through save/load', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		const reloaded = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		await reloaded.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [{ name: 'H', alveoli: [{ coord: [0, 0], alveolus: 'gather', goods: {} }] }],
			}
			engine.loadScenario(scenario)
			const initial = engine.game.freightLines[0]
			expect(initial).toBeDefined()
			engine.game.replaceFreightLine({
				...initial!,
				name: 'Edited gather line',
				filters: ['wood', 'berries'],
				radius: 4,
			})

			const saved = engine.game.saveGameData()
			await reloaded.game.loadGameData(saved)

			expect(reloaded.game.freightLines).toHaveLength(1)
			expect(reloaded.game.freightLines[0]).toMatchObject({
				id: initial!.id,
				name: 'Edited gather line',
				mode: 'gather',
				filters: ['wood', 'berries'],
				radius: 4,
			})
		} finally {
			await engine.destroy()
			await reloaded.destroy()
		}
	})

	it('normalizes v1 freight lines to one stop and gather-only radius', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		try {
			engine.loadScenario({
				hives: [{ name: 'H', alveoli: [{ coord: [0, 0], alveolus: 'gather', goods: {} }] }],
				freightLines: [
					{
						id: 'H:line',
						name: 'Needs normalization',
						mode: 'distribute',
						stops: [
							{ hiveName: 'H', alveolusType: 'gather', coord: [0, 0] },
							{ hiveName: 'H', alveolusType: 'storage', coord: [1, 0] },
						],
						filters: ['wood', 'wood', 'berries'],
						radius: 6,
					},
				],
			})

			const normalized = engine.game.freightLines.find((line) => line.id === 'H:line')
			expect(normalized).toBeDefined()
			expect(normalized).toMatchObject({
				id: 'H:line',
				mode: 'distribute',
				stops: [{ hiveName: 'H', alveolusType: 'freight_bay', coord: [0, 0] }],
				filters: ['wood', 'berries'],
			})
			expect(normalized?.stops).toHaveLength(1)
			expect(normalized?.radius).toBeUndefined()
		} finally {
			await engine.destroy()
		}
	})
})
