import { findLoadOntoVehicleJob } from 'ssh/freight/vehicle-work'
import type { SaveState } from 'ssh/game'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { describe, expect, it } from 'vitest'
import { gatherFreightLine } from '../freight-fixtures'
import { TestEngine } from '../test-engine'

describe('Storage Buffering', () => {
	async function setupEngine() {
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

	it('should allow configuring storage to buffer goods, triggering line-freight gather picks', {
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
								alveolus: 'freight_bay',
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
					{ position: { q: 2, r: 0 }, goodType: 'wood' },
				],
				tiles: [{ coord: [2, 0] as [number, number], terrain: 'grass' }],
				freightLines: [
					gatherFreightLine({
						id: 'GatherHive:bay-gather',
						name: 'Wood gather',
						hiveName: 'GatherHive',
						coord: [1, 0],
						filters: ['wood'],
						radius: 3,
					}),
				],
			}

			engine.loadScenario(scenario)

			const storageTile = game.hex.getTile({ q: 0, r: 0 })
			const storageAlveolus = storageTile?.content as StorageAlveolus
			const gathererTile = game.hex.getTile({ q: 1, r: 0 })
			const gathererAlveolus = gathererTile?.content as StorageAlveolus

			const gathererWorker = spawnWorker({ q: 2, r: 0 })
			gathererWorker.assignedAlveolus = gathererAlveolus
			gathererAlveolus.assignedWorker = gathererWorker

			expect(storageAlveolus.storage.available('wood')).toBe(0)
			expect(gathererAlveolus.nextJob(gathererWorker)).toBeUndefined()

			storageAlveolus.setBuffers({ wood: 10 })

			const line = game.freightLines[0]!
			const vehicle = game.vehicles.createVehicle('buf-wb', 'wheelbarrow', { q: 2, r: 0 }, [line])
			vehicle.beginService(line, line.stops[0]!, gathererWorker)
			gathererWorker.operates = vehicle
			gathererWorker.onboard()

			const loadJob = findLoadOntoVehicleJob(game, gathererWorker)
			expect(loadJob).toMatchObject({
				job: 'zoneBrowse',
				zoneBrowseAction: 'load',
				goodType: 'wood',
			})
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
								alveolus: 'woodpile',
								goods: {},
							},
							{
								coord: [1, 0],
								alveolus: 'freight_bay',
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
				tiles: [{ coord: [2, 0] as [number, number], terrain: 'grass' }],
				freightLines: [
					gatherFreightLine({
						id: 'WoodpileHive:bay-gather',
						name: 'Wood gather',
						hiveName: 'WoodpileHive',
						coord: [1, 0],
						filters: ['wood'],
						radius: 3,
					}),
				],
			}

			engine.loadScenario(scenario)

			const woodpileTile = game.hex.getTile({ q: 0, r: 0 })
			const woodpileAlveolus = woodpileTile?.content as StorageAlveolus

			const gathererTile = game.hex.getTile({ q: 1, r: 0 })
			const gathererAlveolus = gathererTile?.content as StorageAlveolus

			const gathererWorker = spawnWorker({ q: 2, r: 0 })
			gathererWorker.assignedAlveolus = gathererAlveolus
			gathererAlveolus.assignedWorker = gathererWorker
			expect(gathererAlveolus.nextJob(gathererWorker)).toBeUndefined()

			woodpileAlveolus.setBuffers({ wood: 10 })

			const line = game.freightLines[0]!
			const vehicle = game.vehicles.createVehicle('buf-wb2', 'wheelbarrow', { q: 2, r: 0 }, [line])
			vehicle.beginService(line, line.stops[0]!, gathererWorker)
			gathererWorker.operates = vehicle
			gathererWorker.onboard()

			const loadJob = findLoadOntoVehicleJob(game, gathererWorker)
			expect(loadJob).toMatchObject({
				job: 'zoneBrowse',
				zoneBrowseAction: 'load',
				goodType: 'wood',
			})
		} finally {
			await engine.destroy()
		}
	})
})
