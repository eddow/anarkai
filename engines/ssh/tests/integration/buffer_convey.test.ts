import type { SaveState } from 'ssh/game'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('Storage Buffering', () => {
	async function setupEngine() {
		// Fix: Provide required characterCount
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()

		function spawnWorker(coord: { q: number; r: number }) {
			const char = engine.spawnCharacter('Worker', coord)
			char.role = 'worker'
			void char.scriptsContext
			return char
		}

		return { engine, game: engine.game, spawnWorker }
	}

	it('should allow configuring storage to buffer goods, triggering gathering', {
		timeout: 15000,
	}, async () => {
		const { engine, game, spawnWorker } = await setupEngine()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'GatherHive',
						alveoli: [
							{
								coord: [0, 0],
								alveolus: 'storage',
								goods: {},
							},
							{
								coord: [1, 0],
								alveolus: 'gather', // Fix: 'gather' instead of 'gatherer'
								goods: {},
							},
						],
					},
				],
				// Add loose goods at 2,0
				looseGoods: [
					{ position: { q: 2, r: 0 }, goodType: 'wood' },
					{ position: { q: 2, r: 0 }, goodType: 'wood' },
					{ position: { q: 2, r: 0 }, goodType: 'wood' },
					{ position: { q: 2, r: 0 }, goodType: 'wood' },
					{ position: { q: 2, r: 0 }, goodType: 'wood' },
					{ position: { q: 2, r: 0 }, goodType: 'wood' },
				],
				tiles: [{ coord: [2, 0] as [number, number], terrain: 'grass' }],
			}

			engine.loadScenario(scenario)

			const storageTile = game.hex.getTile({ q: 0, r: 0 })
			const storageAlveolus = storageTile?.content as StorageAlveolus
			const gathererTile = game.hex.getTile({ q: 1, r: 0 })
			const gathererAlveolus = gathererTile?.content as any

			const gathererWorker = spawnWorker({ q: 1, r: 0 })
			gathererWorker.assignedAlveolus = gathererAlveolus
			gathererAlveolus.assignedWorker = gathererWorker

			expect(storageAlveolus.storage.available('wood')).toBe(0)
			expect(gathererAlveolus.nextJob(gathererWorker)).toBeUndefined()

			storageAlveolus.setBuffers({ wood: 10 })

			const gatherJob = gathererAlveolus.nextJob(gathererWorker)
			expect(gatherJob).toMatchObject({
				job: 'gather',
				goodType: 'wood',
			})
			expect(gatherJob?.path.at(-1)).toMatchObject({ q: 2, r: 0 })
		} finally {
			await engine.destroy()
		}
	})

	it('should allow configuring woodpile (SpecificStorage) to buffer goods', {
		timeout: 15000,
	}, async () => {
		const { engine, game, spawnWorker } = await setupEngine()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'WoodpileHive',
						alveoli: [
							{
								coord: [0, 0],
								alveolus: 'woodpile', // SpecificStorage
								goods: {},
							},
							{
								coord: [1, 0],
								alveolus: 'gather',
								goods: {},
							},
						],
					},
				],
				looseGoods: [
					{ position: { q: 2, r: 0 }, goodType: 'wood' },
					{ position: { q: 2, r: 0 }, goodType: 'wood' },
					{ position: { q: 2, r: 0 }, goodType: 'wood' },
					{ position: { q: 2, r: 0 }, goodType: 'wood' },
					{ position: { q: 2, r: 0 }, goodType: 'wood' },
				],
			}

			engine.loadScenario(scenario)

			const woodpileTile = game.hex.getTile({ q: 0, r: 0 })
			const woodpileAlveolus = woodpileTile?.content as StorageAlveolus

			const gathererTile = game.hex.getTile({ q: 1, r: 0 })
			const gathererAlveolus = gathererTile?.content as any

			const gathererWorker = spawnWorker({ q: 1, r: 0 })
			gathererWorker.assignedAlveolus = gathererAlveolus
			gathererAlveolus.assignedWorker = gathererWorker
			expect(gathererAlveolus.nextJob(gathererWorker)).toBeUndefined()

			woodpileAlveolus.setBuffers({ wood: 10 })

			const gatherJob = gathererAlveolus.nextJob(gathererWorker)
			expect(gatherJob).toMatchObject({
				job: 'gather',
				goodType: 'wood',
			})
			expect(gatherJob?.path.at(-1)).toMatchObject({ q: 2, r: 0 })
		} finally {
			await engine.destroy()
		}
	})
})
