import type { SaveState } from 'ssh/game'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

// TODO: When buffering is implemented, set the target to a buffering storage and add in the test that the goods are arrived
describe('Convey Behavior Integration', () => {
	async function setupEngine(options: any = { terrainSeed: 1234, characterCount: 0 }) {
		const engine = new TestEngine(options)
		await engine.init()

		function spawnWorker(coord: { q: number; r: number }) {
			const char = engine.spawnCharacter('Worker', coord)
			char.role = 'worker'
			void char.scriptsContext

			const action = char.findAction()
			if (action) char.begin(action)

			return char
		}

		function countLooseGoods(game: (typeof engine)['game'], goodType: string) {
			let count = 0
			for (const goods of game.hex.looseGoods.goods.values()) {
				count += goods.filter((good: any) => good.goodType === goodType).length
			}
			return count
		}

		function countCarriedGoods(game: (typeof engine)['game'], goodType: string) {
			let count = 0
			for (const char of game.population) {
				const stock = (char.carry?.stock ?? {}) as Partial<Record<string, number>>
				count += stock[goodType] ?? 0
			}
			return count
		}

		return {
			engine,
			game: engine.game,
			spawnWorker,
			countLooseGoods,
			countCarriedGoods,
		}
	}

	it('Basic Single Movement: Transfer between adjacent storage alveoli', {
		timeout: 15000,
	}, async () => {
		const { engine, game, spawnWorker, countLooseGoods, countCarriedGoods } = await setupEngine()

		// Setup: Storage with wood, and sawmill that needs wood
		// Sawmill creates stable demand for wood
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
							alveolus: 'sawmill', // Sawmill needs wood as input
							goods: {},
						},
					],
				},
			],
		}

		engine.loadScenario(scenario)

		// Get storage references
		const sourceTile = game.hex.getTile({ q: 0, r: 0 })
		const sourceStorage = sourceTile?.content?.storage
		const targetTile = game.hex.getTile({ q: 1, r: 0 })
		const targetStorage = targetTile?.content?.storage

		// Verify initial state
		expect(sourceStorage).toBeDefined()
		expect(sourceStorage?.stock.wood).toBe(5)
		expect(targetStorage).toBeDefined()
		expect(targetStorage?.stock.wood || 0).toBe(0)

		// Spawn worker at source storage
		await spawnWorker({ q: 0, r: 0 })

		let errorFound = false
		const originalError = console.error
		console.error = (...args: any[]) => {
			const msg = args.join(' ')
			if (msg.includes('Source allocation missing')) {
				errorFound = true
			}
		}

		try {
			const initialTotalWood =
				(sourceStorage?.stock.wood || 0) +
				(targetStorage?.stock.wood || 0) +
				countLooseGoods(game, 'wood') +
				countCarriedGoods(game, 'wood')
			expect(initialTotalWood).toBe(5)

			// Advance until wood is observable outside the source, or a generous cap.
			const maxSteps = 200
			let steps = 0
			let movedWood = 0
			while (steps < maxSteps && movedWood === 0 && !errorFound) {
				engine.tick(0.1)
				if (steps % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
				movedWood =
					(targetStorage?.stock.wood || 0) +
					countCarriedGoods(game, 'wood') +
					countLooseGoods(game, 'wood') +
					(targetStorage?.stock.planks || 0) +
					countLooseGoods(game, 'planks') +
					countCarriedGoods(game, 'planks')
				steps++
			}

			// Verify no source allocation error occurred
			expect(errorFound).toBe(false)

			// Verify goods were actually conveyed or processed.
			const finalTargetStock = targetStorage?.stock.wood || 0
			const finalLooseWood = countLooseGoods(game, 'wood')
			const finalCarriedWood = countCarriedGoods(game, 'wood')
			const finalPlanks =
				(targetStorage?.stock.planks || 0) +
				countLooseGoods(game, 'planks') +
				countCarriedGoods(game, 'planks')
			expect(finalTargetStock + finalCarriedWood + finalLooseWood + finalPlanks).toBeGreaterThan(0)

			const sourceTileContent = game.hex.getTile({ q: 0, r: 0 })?.content as any
			const hive = sourceTileContent?.hive
			expect(hive).toBeDefined()

			expect(movedWood).toBeGreaterThan(0)
		} finally {
			console.error = originalError
			await engine.destroy()
		}
	})

	it('Multi-Hop Movement: Transfer through chain of storage alveoli', {
		timeout: 15000,
	}, async () => {
		const { engine, game, spawnWorker, countLooseGoods, countCarriedGoods } = await setupEngine()

		// Setup: Storage → Storage → Sawmill chain
		// Wood needs to travel through middle storage to reach sawmill
		const scenario: Partial<SaveState> = {
			hives: [
				{
					name: 'ChainHive',
					alveoli: [
						{
							coord: [0, 0],
							alveolus: 'storage',
							goods: { wood: 3 },
						},
						{
							coord: [1, 0],
							alveolus: 'storage',
							goods: {},
						},
						{
							coord: [2, 0],
							alveolus: 'sawmill', // End point that needs wood
							goods: {},
						},
					],
				},
			],
		}

		engine.loadScenario(scenario)

		// Get storage references
		const storageA = game.hex.getTile({ q: 0, r: 0 })?.content?.storage
		const storageB = game.hex.getTile({ q: 1, r: 0 })?.content?.storage
		const storageC = game.hex.getTile({ q: 2, r: 0 })?.content?.storage

		// Verify initial state
		expect(storageA).toBeDefined()
		expect(storageA?.stock.wood).toBe(3)

		// Spawn workers at each location to help convey
		spawnWorker({ q: 0, r: 0 })
		spawnWorker({ q: 1, r: 0 })

		let errorFound = false
		const originalError = console.error
		console.error = (...args: any[]) => {
			const msg = args.join(' ')
			if (msg.includes('Source allocation missing')) {
				errorFound = true
			}
		}

		try {
			engine.tick(0.1)
			await new Promise((resolve) => setTimeout(resolve, 0))

			const maxSteps = 300
			let steps = 0
			let movedWood = 0
			while (steps < maxSteps && movedWood === 0 && !errorFound) {
				engine.tick(0.1)
				if (steps % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
				movedWood =
					(storageB?.stock.wood || 0) +
					(storageC?.stock.wood || 0) +
					(storageC?.stock.planks || 0) +
					countLooseGoods(game, 'wood') +
					countCarriedGoods(game, 'wood') +
					countLooseGoods(game, 'planks') +
					countCarriedGoods(game, 'planks')
				steps++
			}

			// Verify no allocation errors
			expect(errorFound).toBe(false)
			expect(movedWood).toBeGreaterThan(0)
		} finally {
			console.error = originalError
			await engine.destroy()
		}
	})

	it('Circular Blockade: Detect and resolve circular dependencies', {
		timeout: 15000,
	}, async () => {
		const { engine, spawnWorker } = await setupEngine()

		// Setup: Create potential for circular movement with sawmills
		// This tests the cycle detection in aGoodMovement
		const scenario: Partial<SaveState> = {
			hives: [
				{
					name: 'CircularHive',
					alveoli: [
						{
							coord: [0, 0],
							alveolus: 'storage',
							goods: { wood: 2 },
						},
						{
							coord: [1, 0],
							alveolus: 'sawmill', // Needs wood
							goods: {},
						},
						{
							coord: [0, 1],
							alveolus: 'storage',
							goods: { planks: 1 },
						},
					],
				},
			],
		}

		engine.loadScenario(scenario)

		// Spawn workers
		spawnWorker({ q: 0, r: 0 })
		spawnWorker({ q: 1, r: 0 })
		spawnWorker({ q: 0, r: 1 })

		let errorFound = false
		const originalError = console.error
		console.error = (...args: any[]) => {
			const msg = args.join(' ')
			if (msg.includes('Source allocation missing')) {
				errorFound = true
			}
		}

		try {
			engine.tick(0.1)
			await new Promise((resolve) => setTimeout(resolve, 0))

			const maxSteps = 90
			for (let step = 0; step < maxSteps && !errorFound; step++) {
				engine.tick(0.1)
				if (step % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
			}

			// Verify no deadlock or allocation errors
			expect(errorFound).toBe(false)
		} finally {
			console.error = originalError
			await engine.destroy()
		}
	})

	it('Concurrent Movement: Multiple goods moving through same alveolus', {
		timeout: 20000,
	}, async () => {
		const { engine, spawnWorker } = await setupEngine()

		// Setup: Storage hub with sawmills creating demand
		const scenario: Partial<SaveState> = {
			hives: [
				{
					name: 'ConcurrentHive',
					alveoli: [
						{
							coord: [0, 0],
							alveolus: 'storage',
							goods: { wood: 3 },
						},
						{
							coord: [1, 0], // Hub storage
							alveolus: 'storage',
							goods: {},
						},
						{
							coord: [2, 0],
							alveolus: 'sawmill', // Needs wood
							goods: {},
						},
						{
							coord: [1, 1],
							alveolus: 'sawmill', // Also needs wood
							goods: {},
						},
					],
				},
			],
		}

		engine.loadScenario(scenario)

		// Spawn workers at multiple locations
		spawnWorker({ q: 0, r: 0 })
		spawnWorker({ q: 1, r: 0 })
		spawnWorker({ q: 1, r: 1 })

		let errorFound = false
		const originalError = console.error
		console.error = (...args: any[]) => {
			const msg = args.join(' ')
			if (msg.includes('Source allocation missing')) {
				errorFound = true
			}
		}

		try {
			engine.tick(0.1)
			await new Promise((resolve) => setTimeout(resolve, 0))

			const maxSteps = 150
			for (let step = 0; step < maxSteps && !errorFound; step++) {
				engine.tick(0.1)
				if (step % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
			}

			// Verify no allocation conflicts
			expect(errorFound).toBe(false)
		} finally {
			console.error = originalError
			await engine.destroy()
		}
	})
})
