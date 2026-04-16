import type { FreightStop, FreightZoneDefinitionRadius } from 'ssh/freight/freight-line'
import {
	aggregateHiveNeedTypes,
	gatherZoneLoadStopForBay,
	pickGatherTargetInZoneStop,
} from 'ssh/freight/freight-zone-gather-target'
import { findLoadOntoVehicleJob } from 'ssh/freight/vehicle-work'
import type { SaveState } from 'ssh/game'
import { StorageAlveolus } from 'ssh/hive/storage'
import { describe, expect, it } from 'vitest'
import { gatherFreightLine } from '../freight-fixtures'
import { TestEngine } from '../test-engine'
import { bindOperatedWheelbarrowOffload } from '../test-engine/vehicle-bind'

describe('Gatherer Conveying Integration', () => {
	async function setupEngine(options: any = { terrainSeed: 1234, characterCount: 0 }) {
		const engine = new TestEngine(options)
		await engine.init()

		function spawnWorker(coord: { q: number; r: number }) {
			const char = engine.spawnCharacter('Worker', coord)
			char.role = 'worker'
			void char.scriptsContext
			return char
		}

		return { engine, game: engine.game, spawnWorker }
	}

	it('line-freight gather uses loadOntoVehicle (bay does not emit gather jobs)', {
		timeout: 15000,
	}, async () => {
		const { engine, game, spawnWorker } = await setupEngine()

		const scenario: Partial<SaveState> = {
			hives: [
				{
					name: 'GatherHive',
					alveoli: [
						{
							coord: [0, 0],
							alveolus: 'freight_bay',
							goods: {},
						},
						{
							coord: [1, 0],
							alveolus: 'storage',
							goods: {},
						},
					],
				},
			],
			tiles: [
				{ coord: [0, 0] as [number, number], terrain: 'concrete' },
				{ coord: [0, 1] as [number, number], terrain: 'concrete' },
				{ coord: [1, 0] as [number, number], terrain: 'concrete' },
			],
			looseGoods: [
				{ goodType: 'berries', position: { q: 0, r: 1 } },
				{ goodType: 'berries', position: { q: 0, r: 1 } },
				{ goodType: 'berries', position: { q: 0, r: 1 } },
			],
			freightLines: [
				gatherFreightLine({
					id: 'GatherHive:implicit-gather:0,0',
					name: 'Berries gather',
					hiveName: 'GatherHive',
					coord: [0, 0],
					filters: ['berries'],
					radius: 3,
				}),
			],
		}

		engine.loadScenario(scenario)

		const gathererTile = game.hex.getTile({ q: 0, r: 0 })
		const gatherer = gathererTile?.content

		const storageTile = game.hex.getTile({ q: 1, r: 0 })
		const storage = storageTile?.content?.storage

		expect(gatherer).toBeDefined()
		if (gatherer!.constructor.name === 'UnBuiltLand') {
			throw new Error('Gatherer alveolus was not created/placed correctly')
		}
		expect(storage).toBeDefined()

		const storageAlveolus = storageTile!.content
		expect(storageAlveolus).toBeInstanceOf(StorageAlveolus)
		;(storageAlveolus as StorageAlveolus).setBuffers({ berries: 10 })
		await new Promise((r) => setTimeout(r, 0))

		const bay = gatherer as StorageAlveolus
		const worker = spawnWorker({ q: 0, r: 1 })
		worker.assignedAlveolus = bay
		bay.assignedWorker = worker

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('gc-wb', 'wheelbarrow', { q: 0, r: 1 }, [line])
		vehicle.beginService(line, line.stops[0]!, worker)
		worker.operates = vehicle
		worker.onboard()

		const loadJob = findLoadOntoVehicleJob(game, worker)
		expect(loadJob).toMatchObject({
			job: 'zoneBrowse',
			zoneBrowseAction: 'load',
			goodType: 'berries',
		})
	})

	it('keeps gather-line filters authoritative even with unrelated carried goods', async () => {
		const { engine, game, spawnWorker } = await setupEngine()
		try {
			engine.loadScenario({
				hives: [
					{
						name: 'GatherHive',
						alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }],
					},
				],
				tiles: [
					{ coord: [0, 0] as [number, number], terrain: 'concrete' },
					{ coord: [0, 1] as [number, number], terrain: 'concrete' },
				],
				looseGoods: [
					{ goodType: 'berries', position: { q: 0, r: 1 } },
					{ goodType: 'wood', position: { q: 0, r: 1 } },
					{ goodType: 'wood', position: { q: 0, r: 1 } },
				],
				freightLines: [
					gatherFreightLine({
						id: 'GatherHive:implicit-gather:0,0',
						name: 'Filtered gather',
						hiveName: 'GatherHive',
						coord: [0, 0],
						filters: ['berries'],
						radius: 2,
					}),
				],
			})

			const gatherer = game.hex.getTile({ q: 0, r: 0 })?.content as StorageAlveolus
			const worker = spawnWorker({ q: 0, r: 1 })
			worker.role = 'worker'
			const vehicle = game.vehicles.createVehicle('wb-gather-filter', 'wheelbarrow', { q: 0, r: 1 })
			bindOperatedWheelbarrowOffload(worker, vehicle)
			worker.onboard()
			vehicle.storage.addGood('wood', 1)

			const line = game.freightLines[0]!
			const zoneStop = gatherZoneLoadStopForBay(line, gatherer)
			expect(zoneStop).toBeDefined()
			const hiveNeeds = aggregateHiveNeedTypes(game)
			const transport = worker.requireActiveTransportStorage()
			const pick = pickGatherTargetInZoneStop(
				game,
				line,
				zoneStop as FreightStop & { zone: FreightZoneDefinitionRadius },
				worker.position,
				hiveNeeds,
				{
					bayAlveolus: gatherer,
					carrier: {
						hasRoom: (good) => transport.hasRoom(good),
						stock: transport.stock,
					},
				}
			)
			expect(pick?.goodType).toBe('berries')
		} finally {
			await engine.destroy()
		}
	})
})
