import type { SaveState } from 'ssh/game'
import { StorageAlveolus } from 'ssh/hive/storage'
import { describe, expect, it } from 'vitest'
import { gatherFreightLine } from '../freight-fixtures'
import { TestEngine } from '../test-engine'

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

	it('Gatherer should gather goods and convey them to storage', {
		timeout: 15000,
	}, async () => {
		const { engine, game, spawnWorker } = await setupEngine()

		// Setup: Gatherer and Storage, loose berries nearby.
		// Storage advertises demand only for goods with buffer target > current stock (see workingGoodsRelations).
		const scenario: Partial<SaveState> = {
			hives: [
				{
					name: 'GatherHive',
					alveoli: [
						{
							coord: [0, 0],
							alveolus: 'gather',
							goods: {},
						},
						{
							coord: [1, 0],
							alveolus: 'storage', // Should accept berries
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

		// Spawn worker at gatherer
		const worker = spawnWorker({ q: 0, r: 0 })
		worker.assignedAlveolus = gatherer as any
		;(gatherer as any).assignedWorker = worker

		const gatherJob = (gatherer as any).nextJob(worker)
		expect(gatherJob).toMatchObject({
			job: 'gather',
			goodType: 'berries',
		})
		expect(gatherJob?.path?.length).toBeGreaterThan(0)
	})

	it('keeps gather-line filters authoritative even with unrelated carried goods', async () => {
		const { engine, game, spawnWorker } = await setupEngine()
		try {
			engine.loadScenario({
				hives: [
					{
						name: 'GatherHive',
						alveoli: [{ coord: [0, 0], alveolus: 'gather', goods: {} }],
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
			const worker = spawnWorker({ q: 0, r: 0 })
			worker.role = 'worker'
			worker.carry.addGood('wood', 1)

			const gatherJob = gatherer.nextJob(worker)
			expect(gatherJob).toMatchObject({
				job: 'gather',
				goodType: 'berries',
			})
		} finally {
			await engine.destroy()
		}
	})
})
