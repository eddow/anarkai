import {
	applyGatherRadiusFromEditor,
	DEFAULT_GATHER_FREIGHT_RADIUS,
	findDistributeFreightLine,
	findGatherFreightLine,
	freightLineEditorGatherRadius,
	freightLineStationLabel,
	freightLineUid,
	normalizeFreightLineDefinition,
} from 'ssh/freight/freight-line'
import type { SaveState } from 'ssh/game'
import { StorageAlveolus } from 'ssh/hive/storage'
import { describe, expect, it } from 'vitest'
import { distributeFreightLine, gatherFreightLine } from '../freight-fixtures'
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
		expect(content).toBeInstanceOf(StorageAlveolus)
		const gather = content as StorageAlveolus
		expect(gather.hive).toBeDefined()
		expect(engine.game.freightLines.length).toBeGreaterThan(0)
		expect(gather.action).not.toHaveProperty('radius')
		const implicit = engine.game.freightLines[0]
		expect(freightLineEditorGatherRadius(implicit!)).toBe(DEFAULT_GATHER_FREIGHT_RADIUS)
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
		expect(engine.game.hex.getTile({ q: 0, r: 0 })?.content).toBeInstanceOf(StorageAlveolus)
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

	it('uses the gather load zone radius as the gather authority', async () => {
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
					gatherFreightLine({
						id: 'GatherRadiusHive:implicit-gather:0,0',
						name: 'Gather radius',
						hiveName: 'GatherRadiusHive',
						coord: [0, 0],
						filters: ['wood'],
						radius: 1,
					}),
				],
			}
			engine.loadScenario(scenario)
			const gather = engine.game.hex.getTile({ q: 0, r: 0 })?.content as StorageAlveolus
			expect(gather.hasLooseGoodsToGather).toBe(false)
			const line = engine.game.freightLines.find((l) => l.id === 'GatherRadiusHive:implicit-gather:0,0')
			expect(line).toBeDefined()
			engine.game.replaceFreightLine(applyGatherRadiusFromEditor(line!, 2))
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
			distributeFreightLine({
				id: 'H:distribute',
				name: 'Distribute first',
				hiveName: 'H',
				coord: [0, 0],
				filters: ['wood'],
			}),
			gatherFreightLine({
				id: 'H:gather',
				name: 'Gather second',
				hiveName: 'H',
				coord: [0, 0],
				filters: ['berries'],
				radius: 3,
			}),
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

			const gather = engine.game.hex.getTile({ q: 0, r: 0 })?.content as StorageAlveolus
			const implicit = findGatherFreightLine(engine.game.freightLines, gather)
			expect(implicit).toBeDefined()
			const unload = implicit?.stops[1]
			const anchor = unload && 'anchor' in unload ? unload.anchor : undefined
			expect(anchor).toMatchObject({
				kind: 'alveolus',
				hiveName: '',
				alveolusType: 'freight_bay',
				coord: [0, 0],
			})
			expect(freightLineEditorGatherRadius(implicit!)).toBe(DEFAULT_GATHER_FREIGHT_RADIUS)
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
			engine.game.replaceFreightLine(edited)

			const saved = engine.game.saveGameData()
			await reloaded.game.loadGameData(saved)

			expect(reloaded.game.freightLines).toHaveLength(1)
			const reloadedLine = reloaded.game.freightLines[0]!
			const loadStop = reloadedLine.stops[0]
			expect(reloadedLine.id).toBe(initial!.id)
			expect(reloadedLine.name).toBe('Edited gather line')
			expect(loadStop?.loadSelection).toEqual({
				goodRules: [
					{ goodType: 'wood', effect: 'allow' },
					{ goodType: 'berries', effect: 'allow' },
				],
				tagRules: [],
				defaultEffect: 'deny',
			})
			expect(freightLineEditorGatherRadius(reloadedLine)).toBe(4)
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
				hives: [{ name: 'H', alveoli: [{ coord: [0, 0], alveolus: 'gather', goods: {} }] }],
				freightLines: [
					distributeFreightLine({
						id: 'H:line',
						name: 'Distribute with radius',
						hiveName: 'H',
						coord: [0, 0],
						filters: ['wood', 'berries'],
						unloadRadius: 6,
					}),
				],
			})

			const line = engine.game.freightLines.find((l) => l.id === 'H:line')
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
			expect(unloadStop && 'zone' in unloadStop ? unloadStop.zone : undefined).toEqual({
				kind: 'radius',
				center: [0, 0],
				radius: 6,
			})
		} finally {
			await engine.destroy()
		}
	})
})
