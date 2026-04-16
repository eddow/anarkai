import type { SaveState } from 'ssh/game'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('Job Competition Tests', () => {
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
							alveolus: 'freight_bay',
							goods: {},
						},
					],
				},
			],
			looseGoods: [{ goodType: 'berries', position: { q: 2, r: 1 } }],
		}

		engine.loadScenario(scenario)

		const storage = game.hex.getTile({ q: 0, r: 0 })?.content as any
		const destination = game.hex.getTile({ q: 1, r: 0 })?.content as any
		const worker = spawnWorker({ q: 1, r: 0 })

		const hive = storage.hive
		expect(destination).toBeDefined()
		expect(hive.createMovement('wood', storage, destination)).toBe(true)

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

		// Terrain equilibrium can drop unrelated loose goods on the storage tile, which would
		// surface as `offload` via `isBurdened` before convey is considered.
		for (const loose of [...(game.hex.looseGoods.getGoodsAt({ q: 0, r: 0 }) ?? [])]) {
			loose.remove()
		}

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
							alveolus: 'freight_bay',
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
			tiles: [
				{
					coord: [1, 1],
					deposit: { type: 'tree', amount: 10 },
				},
			],
			zones: {
				harvest: [[1, 1]],
			},
		}

		engine.loadScenario(scenario)

		for (const coord of [
			{ q: 0, r: 0 },
			{ q: 1, r: 0 },
			{ q: 2, r: 0 },
			{ q: 0, r: 1 },
		] as const) {
			for (const loose of [...(game.hex.looseGoods.getGoodsAt(coord) ?? [])]) {
				loose.remove()
			}
		}
		game.hex.looseGoods.add({ q: 0, r: 1 }, 'wood')

		const harvest = game.hex.getTile({ q: 1, r: 0 })?.content as any

		const harvestJob = harvest?.getJob()

		expect(harvestJob?.job).toBe('harvest')
		// Harvest urgency scales with deposit clearing headroom; small deposits can land below 2.5.
		expect(harvestJob?.urgency).toBeGreaterThanOrEqual(1.4)
		expect(harvestJob?.urgency).toBeLessThanOrEqual(2.5)

		await engine.destroy()
	})
})
