// @ts-nocheck
import {
	applyGatherRadiusFromEditor,
	findDistributeFreightLine,
	findDistributeRouteSegments,
	findGatherFreightLine,
	findGatherRouteSegments,
	freightLineEditorGatherRadius,
	freightLineStationLabel,
	normalizeFreightLineDefinition,
} from 'ssh/freight/freight-line'
import { measureFreightStopProvidedGoods } from 'ssh/freight/freight-stop-utility'
import type { SaveState } from 'ssh/game'
import { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import { describe, expect, it } from 'vitest'
import { distributeFreightLine, gatherFreightLine } from '../freight-fixtures'
import { TestEngine } from '../test-engine'

describe('Freight line bootstrap', () => {
	it('places a freight bay without synthesizing implicit gather lines', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		const scenario: Partial<SaveState> = {
			hives: [{ name: 'H', alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }] }],
		}
		engine.loadScenario(scenario)
		const content = engine.game.hex.getTile({ q: 0, r: 0 })?.content
		expect(content).toBeInstanceOf(FreightBayAlveolus)
		const gather = content as FreightBayAlveolus
		expect(gather.hive).toBeDefined()
		expect(gather.storage.hasRoom('wood')).toBe(0)
		// No implicit gather line is auto-created: freight lines are explicit-only.
		expect(engine.game.freightLines.size).toBe(0)
		expect(gather.action).not.toHaveProperty('radius')
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
						{ coord: [0, 0], alveolus: 'freight_bay', goods: {} },
						{ coord: [1, 0], alveolus: 'woodpile', goods: {} },
					],
				},
			],
			looseGoods: [],
		}
		engine.loadScenario(scenario)
		expect(engine.game.hex.getTile({ q: 0, r: 0 })?.content).toBeInstanceOf(FreightBayAlveolus)
		expect(engine.game.hex.getTile({ q: 1, r: 0 })?.content).toBeDefined()
		await engine.destroy()
	})

	it('does not map the legacy gather alveolus key to freight_bay', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		try {
			engine.loadScenario({
				hives: [{ name: 'H', alveoli: [{ coord: [0, 0], alveolus: 'gather' } as never] }],
			})
			expect(engine.game.hex.getTile({ q: 0, r: 0 })?.content?.name).not.toBe('freight_bay')
			expect([...engine.game.freightLines]).toEqual([])
		} finally {
			await engine.destroy()
		}
	})

	it('uses the gather load zone radius as the gather authority', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'GatherRadiusHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'freight_bay', goods: {} },
							{ coord: [1, 0], alveolus: 'sawmill', goods: {} },
						],
					},
				],
				looseGoods: {
					wood: [[0, 2]],
				},
				freightLines: [
					gatherFreightLine({
						name: 'Gather radius',
						hiveName: 'GatherRadiusHive',
						coord: [0, 0],
						filters: ['wood'],
						radius: 1,
					}),
				],
			}
			engine.loadScenario(scenario)
			const gather = engine.game.hex.getTile({ q: 0, r: 0 })?.content as FreightBayAlveolus
			// Only the explicit gather line exists — no implicit gather line is synthesized.
			const line = [...engine.game.freightLines].find((l) => l.name === 'Gather radius')
			expect(line).toBeDefined()
			expect(engine.game.freightLines.size).toBe(1)
			expect(gather.hasLooseGoodsToGather).toBe(false)
			engine.game.replaceFreightLine(line!, applyGatherRadiusFromEditor(line!, 2))
			expect(gather.hasLooseGoodsToGather).toBe(true)
		} finally {
			await engine.destroy()
		}
	})

	it('resolves gather and distribute lines independently on the same stop', () => {
		const stop = {
			hive: { name: 'H' },
			name: 'freight_bay',
			tile: { position: { q: 0, r: 0 } },
		}
		const lines = [
			distributeFreightLine({
				name: 'Distribute first',
				hiveName: 'H',
				coord: [0, 0],
				filters: ['wood'],
			}),
			gatherFreightLine({
				name: 'Gather second',
				hiveName: 'H',
				coord: [0, 0],
				filters: ['berries'],
				radius: 3,
			}),
		]

		expect(findGatherFreightLine(lines, stop)?.name).toBe('Gather second')
		expect(findDistributeFreightLine(lines, stop)?.name).toBe('Distribute first')
	})

	it('does not synthesize gather lines for unnamed hives', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		try {
			engine.loadScenario({
				hives: [{ alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }] }],
			})

			const gather = engine.game.hex.getTile({ q: 0, r: 0 })?.content as FreightBayAlveolus
			// No implicit gather line is auto-created, even for unnamed hives.
			expect(findGatherFreightLine(engine.game.freightLines, gather)).toBeUndefined()
		} finally {
			await engine.destroy()
		}
	})

	it('formats station labels as hive name with coordinates', () => {
		expect(freightLineStationLabel({ hiveName: 'ChopSaw', coord: [10, -8] })).toBe(
			'ChopSaw (10, -8)'
		)
		expect(freightLineStationLabel({ hiveName: '', coord: [0, 0] })).toBe('Hive (0, 0)')
	})

	it('round-trips edited freight line settings through save/load', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		const reloaded = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		await reloaded.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [{ name: 'H', alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }] }],
				freightLines: [
					gatherFreightLine({
						name: 'Gather line',
						hiveName: 'H',
						coord: [0, 0],
						filters: ['wood'],
						radius: 9,
					}),
				],
			}
			engine.loadScenario(scenario)
			const initial = [...engine.game.freightLines][0]
			expect(initial).toBeDefined()
			const edited = applyGatherRadiusFromEditor(
				normalizeFreightLineDefinition({
					...initial!,
					name: 'Edited gather line',
					stops: initial!.stops.map((stop, index) =>
						index === 0 && 'zone' in stop
							? {
									...stop,
									loadSelection: {
										goodRules: [
											{ goodType: 'wood', effect: 'allow' as const },
											{ goodType: 'berries', effect: 'allow' as const },
										],
										tagRules: [],
										defaultEffect: 'deny' as const,
									},
								}
							: stop
					),
				}),
				4
			)
			engine.game.replaceFreightLine(initial!, edited)

			const saved = engine.game.saveGameData()
			await reloaded.game.loadGameData(saved)

			// The explicit line round-trips by array position (index-based serialization).
			const reloadedLine = [...reloaded.game.freightLines].find(
				(l) => l.name === 'Edited gather line'
			)
			expect(reloadedLine).toBeDefined()
			const loadStop = reloadedLine!.stops[0]
			expect(loadStop?.loadSelection).toEqual({
				goodRules: [
					{ goodType: 'wood', effect: 'allow' },
					{ goodType: 'berries', effect: 'allow' },
				],
				tagRules: [],
				defaultEffect: 'deny',
			})
			expect(freightLineEditorGatherRadius(reloadedLine!)).toBe(4)
		} finally {
			await engine.destroy()
			await reloaded.destroy()
		}
	})

	it('loads explicit distribute lines with unload radius zones', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		try {
			engine.loadScenario({
				hives: [{ name: 'H', alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }] }],
				freightLines: [
					distributeFreightLine({
						name: 'Distribute with radius',
						hiveName: 'H',
						coord: [0, 0],
						filters: ['wood', 'berries'],
						unloadRadius: 6,
					}),
				],
			})

			const line = [...engine.game.freightLines].find((l) => l.name === 'Distribute with radius')
			expect(line).toBeDefined()
			expect(line?.stops).toHaveLength(2)
			expect(line?.stops[0]?.loadSelection).toEqual({
				goodRules: [
					{ goodType: 'wood', effect: 'allow' },
					{ goodType: 'berries', effect: 'allow' },
				],
				tagRules: [],
				defaultEffect: 'deny',
			})
			const unloadStop = line?.stops[1]
			const unloadZone = unloadStop && 'zone' in unloadStop ? unloadStop.zone : undefined
			expect(unloadZone).toMatchObject({
				kind: 'radius',
				center: [0, 0],
				radius: 6,
			})
		} finally {
			await engine.destroy()
		}
	})

	it('uses named tile zones as gather and distribute stop authority', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		try {
			engine.loadScenario({
				hives: [{ name: 'H', alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }] }],
				looseGoods: {
					wood: [
						[1, 0],
						[4, 0],
					],
				},
				zones: [{ name: 'North Grove', color: '#4f8cff', type: 'harvest', coords: [[1, 0]] }],
				freightLines: [
					{
						name: 'Named gather',
						stops: [
							{ id: 'named-load', zone: { kind: 'named', zoneIndex: 0 } },
							{
								anchor: {
									kind: 'alveolus',
									hiveName: 'H',
									alveolusType: 'freight_bay',
									coord: [0, 0],
								},
							},
						],
					},
				],
			})

			const line = [...engine.game.freightLines].find((entry) => entry.name === 'Named gather')!
			expect(findGatherRouteSegments(line)).toEqual([{ loadStopIndex: 0, unloadStopIndex: 1 }])
			expect(findDistributeRouteSegments(line)).toEqual([])
			expect(measureFreightStopProvidedGoods(engine.game, line, 0).perGood).toEqual({ wood: 1 })

			const saved = engine.game.saveGameData()
			expect(saved.zones).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: 'north-grove',
						color: '#4f8cff',
						type: 'harvest',
						coords: [[1, 0]],
					}),
				])
			)
		} finally {
			await engine.destroy()
		}
	})
})
