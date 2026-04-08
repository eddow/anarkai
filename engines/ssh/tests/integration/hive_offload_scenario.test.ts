import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { Tile } from 'ssh/board/tile'
import { debugActiveAllocations, resetDebugActiveAllocations } from 'ssh/storage/guard'
import { toAxialCoord } from 'ssh/utils/position'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('Hive Offload Scenario', () => {
	it('Scenario: Offload Mushroom', { timeout: 15000 }, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game
		try {
			const scenario = {
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				looseGoods: [{ goodType: 'mushrooms', position: { q: 2, r: 2 } }],
				hives: [
					{
						name: 'TestHive',
						alveoli: [
							{
								coord: [2, 2],
								alveolus: 'tree_chopper',
								goods: {},
							},
						],
					},
				],
			}

			engine.loadScenario(scenario as any)

			const char = engine.spawnCharacter('Worker', { q: 2, r: 2 })

			void char.scriptsContext

			const tile = game.hex.getTile({ q: 2, r: 2 })
			expect(tile).toBeDefined()
			expect(tile?.availableGoods.length).toBe(1)
			expect(tile?.availableGoods[0].goodType).toBe('mushrooms')
			expect((tile?.content as any).hive).toBeDefined()

			const directJob = tile!.getJob(char)
			expect(directJob?.job).toBe('offload')
			if (directJob?.job !== 'offload') throw new Error('Expected a concrete offload job')
			expect(directJob.looseGood.goodType).toBe('mushrooms')
			expect(directJob.looseGood.available).toBe(true)
			const bestJob = char.findBestJob()
			expect(bestJob).toBeTruthy()
			if (!bestJob) throw new Error('Character failed to find offload job')
			char.begin(bestJob)
			expect(directJob.looseGood.available).toBe(false)
			expect(tile!.availableGoods.length).toBe(0)

			const tickRate = 0.1
			const maxTime = 6.0
			let time = 0

			let pickedUp = false

			while (time < maxTime) {
				engine.tick(tickRate, tickRate)

				if (char.vehicle.storage.stock.mushrooms === 1) {
					pickedUp = true
				}

				if (pickedUp && (char.vehicle.storage.stock.mushrooms || 0) === 0) {
					break
				}
				time += tickRate
			}

			expect(tile!.availableGoods.length).toBe(0)

			expect(char.vehicle.storage.stock.mushrooms || 0).toBe(0)

			let foundTile: any = null
			for (const t of game.hex.tiles) {
				if (t.availableGoods.length > 0) {
					foundTile = t
					break
				}
			}

			expect(foundTile).toBeDefined()
			expect(foundTile.availableGoods[0].goodType).toBe('mushrooms')

			const foundCoord = foundTile.position
			expect(foundCoord.q === 2 && foundCoord.r === 2).toBe(false)

			expect((foundTile.content as any).hive).toBeUndefined()
		} finally {
			await engine.destroy()
		}
	})

	it('Scenario: Offload Lifecycle Keeps LooseGood Present Until Pickup Fulfills', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game
		try {
			const target = { q: 2, r: 2 }
			engine.loadScenario({
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				looseGoods: [{ goodType: 'mushrooms', position: target }],
				hives: [
					{
						name: 'LifecycleHive',
						alveoli: [
							{
								coord: [2, 2],
								alveolus: 'tree_chopper',
								goods: {},
							},
						],
					},
				],
			} as any)

			const char = engine.spawnCharacter('Worker', target)
			void char.scriptsContext

			const tile = game.hex.getTile(target)!
			const directJob = tile.getJob(char)
			expect(directJob?.job).toBe('offload')
			if (directJob?.job !== 'offload') throw new Error('Expected a concrete offload job')

			const looseGood = directJob.looseGood
			expect(tile.availableGoods.length).toBe(1)
			expect(looseGood.isRemoved).toBe(false)
			expect(looseGood.available).toBe(true)

			const action = char.findBestJob()
			expect(action).toBeTruthy()
			if (!action) throw new Error('Expected an offload action')

			char.begin(action)

			expect(looseGood.isRemoved).toBe(false)
			expect(looseGood.available).toBe(false)
			expect(game.hex.looseGoods.getGoodsAt(target)).toContain(looseGood)
			expect(tile.availableGoods.length).toBe(0)
			expect(char.vehicle.storage.stock.mushrooms || 0).toBe(0)

			const timeline: string[] = []
			let firstRemovedAt: number | undefined
			let firstCarriedAt: number | undefined
			let time = 0
			for (let i = 0; i < 80; i++) {
				const carried = char.vehicle.storage.stock.mushrooms || 0
				timeline.push(
					`${time.toFixed(2)} removed=${String(looseGood.isRemoved)} available=${String(looseGood.available)} onTile=${String(game.hex.looseGoods.getGoodsAt(target).includes(looseGood))} carried=${carried} step=${char.stepExecutor?.constructor.name ?? 'none'} desc=${String(char.stepExecutor?.description ?? 'none')}`
				)
				if (looseGood.isRemoved && firstRemovedAt === undefined) firstRemovedAt = time
				if (carried > 0 && firstCarriedAt === undefined) firstCarriedAt = time
				if (firstRemovedAt !== undefined && firstCarriedAt !== undefined) break
				engine.tick(0.05, 0.05)
				time += 0.05
				if (!looseGood.isRemoved) {
					expect(looseGood.available).toBe(false)
					expect(game.hex.looseGoods.getGoodsAt(target)).toContain(looseGood)
				}
			}

			expect(firstRemovedAt, timeline.join('\n')).toBeDefined()
			expect(firstCarriedAt, timeline.join('\n')).toBeDefined()
			expect(firstRemovedAt, timeline.join('\n')).toBeGreaterThan(0)
			expect(firstCarriedAt, timeline.join('\n')).toBeGreaterThan(0)
			expect(firstRemovedAt, timeline.join('\n')).toBe(firstCarriedAt)
			expect(looseGood.isRemoved, timeline.join('\n')).toBe(true)
			expect(game.hex.looseGoods.getGoodsAt(target), timeline.join('\n')).not.toContain(looseGood)
			expect(char.vehicle.storage.stock.mushrooms || 0, timeline.join('\n')).toBe(1)

			time = 0
			while (time < 6 && (char.vehicle.storage.stock.mushrooms || 0) > 0) {
				engine.tick(0.1, 0.1)
				time += 0.1
			}

			expect(char.vehicle.storage.stock.mushrooms || 0).toBe(0)
		} finally {
			await engine.destroy()
		}
	})

	it('Scenario: Offload Mushroom Must Not Leave Pickup Or Drop Allocations Alive', {
		timeout: 15000,
	}, async () => {
		resetDebugActiveAllocations()
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game
		try {
			const center = { q: 2, r: 2 }
			engine.loadScenario({
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				looseGoods: [{ goodType: 'mushrooms', position: center }],
				hives: [
					{
						name: 'LeakCheckHive',
						alveoli: [{ coord: [2, 2], alveolus: 'tree_chopper', goods: {} }],
					},
				],
			} as any)

			const worker = engine.spawnCharacter('Worker', center)
			worker.role = 'worker'
			void worker.scriptsContext

			const action = worker.findBestJob()
			expect(action).toBeTruthy()
			if (!action) throw new Error('Expected initial offload action')
			worker.begin(action)

			let time = 0
			while (time < 4) {
				engine.tick(0.1, 0.1)
				if ((worker.vehicle.storage.stock.mushrooms || 0) === 0) {
					const dropped = game.hex.tiles.some((tile) =>
						tile.availableGoods.some((good) => good.goodType === 'mushrooms')
					)
					if (dropped) break
				}
				time += 0.1
			}

			const activeReasons = debugActiveAllocations().map(({ reason }) => reason)
			expect(activeReasons).not.toContain('plan.pickup')
			expect(activeReasons).not.toContain('drop.mushrooms')
		} finally {
			resetDebugActiveAllocations()
			await engine.destroy()
		}
	})

	it('Scenario: Avoid Dropping on Alveoli', { timeout: 5000 }, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game

		const center = { q: 5, r: 5 }

		// Setup: Center has mushrooms
		// Neighbor (6,5) has an Alveolus (e.g. storage or another chopper)
		// Neighbor (4,5) is empty UnBuiltLand
		// Character offloads from center.
		// EXPECT: Drop on (4,5), NOT (6,5)

		const scenario = {
			generationOptions: {
				terrainSeed: 1234,
				characterCount: 0,
			},
			looseGoods: [{ goodType: 'mushrooms', position: center }],
			hives: [
				{
					name: 'BlockerHive',
					alveoli: [
						{
							coord: [6, 5],
							alveolus: 'storage', // Blocker
							goods: {},
						},
						{
							coord: [5, 5], // Center - needs to be alveolus/residential to trigger offload
							alveolus: 'tree_chopper',
							goods: {},
						},
					],
				},
			],
		}

		engine.loadScenario(scenario as any)

		const char = engine.spawnCharacter('Worker', center)
		void char.scriptsContext

		// Trigger offload
		const bestJob = char.findBestJob()
		if (bestJob) char.begin(bestJob)
		else throw new Error('No job found')

		// Run
		let time = 0
		while (time < 10) {
			engine.tick(0.1, 0.1)
			if ((char.vehicle.storage.stock.mushrooms || 0) === 0 && char.tiredness > 0.1) break // simplistic 'done' check
			time += 0.1
		}

		// Check where it went
		const neighborAlveolusTile = game.hex.getTile({ q: 6, r: 5 })

		const goodsOnAlveolus = game.hex.looseGoods.getGoodsAt(neighborAlveolusTile!.position)

		// Should NOT be on alveolus
		expect(goodsOnAlveolus.length).toBe(0)

		// MIGHT be on empty (or any other empty neighbor, but definitely not alveolus)
		// We can just assert that no good is on the alveolus tile.
	})

	it('Scenario: Offload Engagement Allocates The Mushroom Before A Second Worker Can Commit', {
		timeout: 5000,
	}, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game

		const target = { q: 4, r: 4 }
		const scenario = {
			generationOptions: {
				terrainSeed: 1234,
				characterCount: 0,
			},
			looseGoods: [{ goodType: 'mushrooms', position: target }],
			hives: [
				{
					name: 'ContestHive',
					alveoli: [
						{
							coord: [4, 4],
							alveolus: 'tree_chopper',
							goods: {},
						},
					],
				},
			],
		}

		engine.loadScenario(scenario as any)

		const workerA = engine.spawnCharacter('Worker', { q: 3, r: 4 })
		const workerB = engine.spawnCharacter('Worker', { q: 5, r: 4 })
		workerA.role = 'worker'
		workerB.role = 'worker'
		void workerA.scriptsContext
		void workerB.scriptsContext

		const tileBeforeEngagement = game.hex.getTile(target)!
		const directJobA = tileBeforeEngagement.getJob(workerA)
		const directJobB = tileBeforeEngagement.getJob(workerB)
		const jobA = workerA.findBestJob()

		expect(directJobA?.job).toBe('offload')
		expect(directJobB?.job).toBe('offload')
		if (directJobA?.job !== 'offload' || directJobB?.job !== 'offload') {
			throw new Error('Expected concrete offload jobs before engagement')
		}
		expect(directJobA.looseGood).toBeTruthy()
		expect(directJobA.looseGood.goodType).toBe('mushrooms')
		expect(directJobB.looseGood.goodType).toBe('mushrooms')
		expect(jobA).toBeTruthy()
		if (!jobA) throw new Error('First worker failed to find contested offload job')

		workerA.begin(jobA)
		expect(directJobA.looseGood?.available).toBe(false)

		const tileAfterEngagement = game.hex.getTile(target)!
		expect(tileAfterEngagement.availableGoods.length).toBe(0)
		expect(tileAfterEngagement.getJob(workerB)).toBeUndefined()
		expect(workerB.findBestJob()).toBe(false)

		let oneWorkerPickedUp = false
		let maxCarried = 0

		for (let i = 0; i < 80; i++) {
			engine.tick(0.1, 0.1)
			const carried =
				(workerA.vehicle.storage.stock.mushrooms || 0) +
				(workerB.vehicle.storage.stock.mushrooms || 0)
			maxCarried = Math.max(maxCarried, carried)
			if (carried > 0) oneWorkerPickedUp = true
		}

		expect(oneWorkerPickedUp).toBe(true)
		expect(maxCarried).toBe(1)
		expect(game.hex.getTile(target)!.availableGoods.length).toBe(0)
		expect(
			(workerA.vehicle.storage.stock.mushrooms || 0) +
				(workerB.vehicle.storage.stock.mushrooms || 0)
		).toBe(0)
	})

	it('Scenario: Removed LooseGood Before Offload Engagement Does Not Assert', {
		timeout: 5000,
	}, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game

		const target = { q: 4, r: 4 }
		engine.loadScenario({
			generationOptions: {
				terrainSeed: 1234,
				characterCount: 0,
			},
			looseGoods: [{ goodType: 'mushrooms', position: target }],
			hives: [
				{
					name: 'ContestHive',
					alveoli: [
						{
							coord: [4, 4],
							alveolus: 'tree_chopper',
							goods: {},
						},
					],
				},
			],
		} as any)

		const worker = engine.spawnCharacter('Worker', { q: 3, r: 4 })
		worker.role = 'worker'
		void worker.scriptsContext

		const tile = game.hex.getTile(target)!
		const directJob = tile.getJob(worker)
		expect(directJob?.job).toBe('offload')
		if (directJob?.job !== 'offload') throw new Error('Expected offload job before engagement')

		directJob.looseGood?.remove()

		const action = worker.findBestJob()
		expect(() => {
			if (action) worker.begin(action)
		}).not.toThrow()
	})

	it('Scenario: Residential Offload Drop Target Must Not Re-Offer Offload', {
		timeout: 5000,
	}, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game

		const center = { q: 5, r: 5 }
		const residentialDrop = { q: 4, r: 5 }
		engine.loadScenario({
			generationOptions: {
				terrainSeed: 1234,
				characterCount: 0,
			},
			looseGoods: [{ goodType: 'mushrooms', position: center }],
			hives: [
				{
					name: 'ResidentialLoopHive',
					alveoli: [
						{ coord: [5, 5], alveolus: 'tree_chopper', goods: {} },
						{ coord: [6, 5], alveolus: 'storage', goods: {} },
						{ coord: [6, 4], alveolus: 'storage', goods: {} },
						{ coord: [5, 4], alveolus: 'storage', goods: {} },
						{ coord: [4, 6], alveolus: 'storage', goods: {} },
						{ coord: [5, 6], alveolus: 'storage', goods: {} },
					],
				},
			],
			zones: {
				residential: [[4, 5]],
			},
		} as any)

		const worker = engine.spawnCharacter('Worker', center)
		worker.role = 'worker'
		void worker.scriptsContext

		const initialAction = worker.findBestJob()
		expect(initialAction).toBeTruthy()
		if (!initialAction) throw new Error('Expected initial offload action')
		worker.begin(initialAction)

		let time = 0
		let foundTile: Tile | undefined
		while (time < 10) {
			engine.tick(0.1, 0.1)
			if ((worker.vehicle.storage.stock.mushrooms || 0) === 0) {
				// Find where the mushroom was dropped
				for (const t of game.hex.tiles) {
					if (t.availableGoods.some((good) => good.goodType === 'mushrooms')) {
						foundTile = t
						break
					}
				}
				if (foundTile) break
			}
			time += 0.1
		}

		expect(foundTile).toBeDefined()
		if (!foundTile) throw new Error('Expected dropped tile to be found')
		expect(foundTile.availableGoods.some((good) => good.goodType === 'mushrooms')).toBe(true)
		expect(foundTile.getJob(worker)).toBeUndefined()

		// Verify it didn't drop on residential tile
		const foundCoord = toAxialCoord(foundTile.position)
		expect(foundCoord.q === residentialDrop.q && foundCoord.r === residentialDrop.r).toBe(false)
		expect(foundTile.zone).not.toBe('residential')
		expect(foundTile.content instanceof UnBuiltLand).toBe(true)
	})

	it('Scenario: Offloaded Mushroom Must Stabilize Instead Of Re-Offloading Forever', {
		timeout: 5000,
	}, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game

		const center = { q: 5, r: 5 }
		engine.loadScenario({
			generationOptions: {
				terrainSeed: 1234,
				characterCount: 0,
			},
			looseGoods: [{ goodType: 'mushrooms', position: center }],
			hives: [
				{
					name: 'ResidentialDriftHive',
					alveoli: [{ coord: [5, 5], alveolus: 'tree_chopper', goods: {} }],
				},
			],
			zones: {
				residential: [
					[4, 5],
					[4, 4],
					[5, 4],
					[6, 4],
					[6, 5],
					[5, 6],
					[4, 6],
					[3, 5],
					[3, 4],
					[4, 3],
					[5, 3],
					[6, 3],
					[7, 4],
					[7, 5],
					[6, 6],
					[5, 7],
					[4, 7],
					[3, 6],
				],
			},
		} as any)

		const worker = engine.spawnCharacter('Worker', center)
		worker.role = 'worker'
		void worker.scriptsContext

		const initialAction = worker.findBestJob()
		expect(initialAction).toBeTruthy()
		if (!initialAction) throw new Error('Expected initial offload action')
		worker.begin(initialAction)

		let firstDropTime = 0
		while (firstDropTime < 10) {
			engine.tick(0.1, 0.1)
			if ((worker.vehicle.storage.stock.mushrooms || 0) === 0) {
				let foundDropped = false
				for (const tile of game.hex.tiles) {
					if (tile.availableGoods.some((good) => good.goodType === 'mushrooms')) {
						foundDropped = true
						break
					}
				}
				if (foundDropped) break
			}
			firstDropTime += 0.1
		}

		const seenCoords = new Set<string>()
		const timeline: string[] = []
		let pickedUpAgain = false
		for (let i = 0; i < 80; i++) {
			const carried = worker.vehicle.storage.stock.mushrooms || 0
			if (carried > 0) pickedUpAgain = true
			let coordLabel = 'none'
			for (const tile of game.hex.tiles) {
				if (tile.availableGoods.some((good) => good.goodType === 'mushrooms')) {
					const coord = toAxialCoord(tile.position)
					coordLabel = `${coord.q},${coord.r}`
					seenCoords.add(coordLabel)
					break
				}
			}
			timeline.push(
				`${(i * 0.1).toFixed(1)} carried=${carried} loose=${coordLabel} step=${String(worker.stepExecutor?.description ?? 'none')} action=${worker.actionDescription.join('>')}`
			)
			engine.tick(0.1, 0.1)
		}

		expect(pickedUpAgain, timeline.join('\n')).toBe(false)
		expect(seenCoords.size, timeline.join('\n')).toBeLessThanOrEqual(1)
	})

	it('Scenario: Tree Chopper Adjacent To Trees Must Offer Work Instead Of Leaving Workers To Wander', {
		timeout: 10000,
	}, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game

		const workerStart = { q: 5, r: 5 }
		const chopperLocation = { q: 4, r: 5 }
		const treeLocation = { q: 4, r: 4 }
		engine.loadScenario({
			generationOptions: {
				terrainSeed: 1234,
				characterCount: 0,
			},
			tiles: [
				{
					coord: [4, 4],
					deposit: { type: 'tree', name: 'tree', amount: 10 },
					terrain: 'forest',
				},
			],
			hives: [
				{
					name: 'WorkHive',
					alveoli: [{ coord: [4, 5], alveolus: 'tree_chopper', goods: {} }],
				},
			],
		} as any)

		const worker = engine.spawnCharacter('Worker', workerStart)
		worker.role = 'worker'
		void worker.scriptsContext

		const chopperTile = game.hex.getTile(chopperLocation)!
		const directJob = chopperTile.content?.getJob(worker)
		expect(directJob).toBeTruthy()
		expect(directJob?.job).toBe('harvest')

		const action = worker.findAction()
		expect(action).toBeTruthy()
		if (!action) throw new Error('Worker should find harvest work')
		expect(action.name).toBe('work.goWork')

		worker.begin(action)

		let reachedTree = false
		const timeline: string[] = []
		for (let i = 0; i < 80; i++) {
			const coord = toAxialCoord(worker.position)
			timeline.push(
				`${(i * 0.1).toFixed(1)} coord=${coord.q},${coord.r} action=${worker.actionDescription.join('>')} step=${String(worker.stepExecutor?.description ?? 'none')}`
			)
			const tileCoord = toAxialCoord(worker.tile.position)
			if (tileCoord.q === treeLocation.q && tileCoord.r === treeLocation.r) {
				reachedTree = true
				break
			}
			engine.tick(0.1, 0.1)
		}

		expect(reachedTree, timeline.join('\n')).toBe(true)
	})
})
