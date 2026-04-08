import type { SaveState } from 'ssh/game'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('Job Competition Tests', () => {
	async function setupEngine(
		options: any = { terrainSeed: 1234, characterCount: 0 }
	) {
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

	it('convey job should have higher urgency than harvest job', {
		timeout: 10000,
	}, async () => {
		const { engine, game, spawnWorker } = await setupEngine()

		// Setup simple scenario with storage-to-storage movement
		const scenario: Partial<SaveState> = {
			hives: [
				{
					name: 'TestHive',
					alveoli: [
						{
							coord: [0, 0],
							alveolus: 'storage',
							goods: { wood: 5 },
						},
						{
							coord: [1, 0],
							alveolus: 'storage', // Use storage as destination for proper path
							goods: {},
						},
						{
							coord: [2, 0],
							alveolus: 'gather',
							goods: {},
						},
					],
				},
			],
			looseGoods: [{ goodType: 'berries', position: { q: 2, r: 1 } }],
		}

		engine.loadScenario(scenario)

		const storage = game.hex.getTile({ q: 0, r: 0 })?.content as any
		const worker = spawnWorker({ q: 1, r: 0 })

		// Manually create a movement at storage to trigger convey job
		// Path must include border position (midpoint) then destination tile
		const hive = storage.hive
		hive.movingGoods.set({ q: 0, r: 0 }, [
			{
				goodType: 'wood',
				from: { q: 0, r: 0 },
				path: [
					{ q: 0.5, r: 0 },
					{ q: 1, r: 0 },
				], // Border position first, then destination
			},
		])

		// Now check jobs
		const storageJob = storage.getJob(worker)

		// Storage should offer convey with urgency 3 (higher than harvest's 2.5 max)
		expect(storageJob).toBeDefined()
		expect(storageJob?.job).toBe('convey')
		expect(storageJob?.urgency).toBe(3)

		// Verify convey urgency is higher than typical alveolus jobs
		// (harvest: 2.5 max, transform: 1, etc.)
		expect(storageJob!.urgency).toBeGreaterThan(2.5)
		expect(storageJob!.urgency).toBeLessThan(4) // Still below offload

		await engine.destroy()
	})

	it('convey should not be selected when no movement available', {
		timeout: 10000,
	}, async () => {
		const { engine, game, spawnWorker } = await setupEngine()

		// Setup scenario with storage but NO movements
		const scenario: Partial<SaveState> = {
			hives: [
				{
					name: 'NoMovementHive',
					alveoli: [
						{
							coord: [0, 0],
							alveolus: 'storage',
							goods: { wood: 5 },
						},
					],
				},
			],
		}

		engine.loadScenario(scenario)

		const worker = spawnWorker({ q: 0, r: 0 })
		const storage = game.hex.getTile({ q: 0, r: 0 })?.content

		// No movement should be available
		const storageJob = storage?.getJob(worker)
		expect(storageJob).toBeUndefined()

		// Worker should not find any job at storage
		const bestJob = worker.findBestJob()
		expect(bestJob).toBeFalsy()

		await engine.destroy()
	})

	it('gather job should be at least as urgent as harvest job', {
		timeout: 10000,
	}, async () => {
		const { engine, game } = await setupEngine()

		const scenario: Partial<SaveState> = {
			hives: [
				{
					name: 'GatherVsHarvest',
					alveoli: [
						{
							coord: [0, 0],
							alveolus: 'gather',
							goods: {},
						},
						{
							coord: [1, 0],
							alveolus: 'tree_chopper',
							goods: {},
						},
						{
							coord: [2, 0],
							alveolus: 'sawmill',
							goods: {},
						},
					],
				},
			],
			looseGoods: [{ goodType: 'wood', position: { q: 0, r: 1 } }],
			tiles: [
				{
					coord: [1, 1],
					deposit: { type: 'tree', amount: 1 },
				},
			],
			zones: {
				harvest: [[1, 1]],
			},
		}

		engine.loadScenario(scenario)

		const gather = game.hex.getTile({ q: 0, r: 0 })?.content as any
		const harvest = game.hex.getTile({ q: 1, r: 0 })?.content as any

		const gatherJob = gather?.getJob()
		const harvestJob = harvest?.getJob()

		expect(gatherJob?.job).toBe('gather')
		expect(harvestJob?.job).toBe('harvest')
		expect(gatherJob?.urgency).toBeGreaterThanOrEqual(harvestJob?.urgency ?? 0)
		expect(gatherJob?.urgency).toBe(2.5)
		expect(harvestJob?.urgency).toBe(2.5)

		await engine.destroy()
	})
})
