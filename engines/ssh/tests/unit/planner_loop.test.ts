/**
 * Diagnostic test: proves and characterises the reactive planner loop.
 *
 * Hypothesis:
 *   gather.goodsRelations <- workingGoodsRelations <- storage.availables
 *   storage.availables depends on _reserved (memoized)
 *   createMovement calls reserve() -> mutates slot.reserved -> invalidates availables
 *   -> goodsRelations changes -> advertise effect re-runs -> advertise() -> selectMovement()
 *   -> queueMicrotask(createMovement) -> reserve() -> ... infinite loop
 */

import { effect, getActivationLog, reactiveOptions, reset } from 'mutts'
import type { SaveState } from 'ssh/game'
import type { SlottedStorage } from 'ssh/storage/slotted-storage'
import { toAxialCoord } from 'ssh/utils/position'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('Planner loop diagnostic', () => {
	let originalMaxChain: typeof reactiveOptions.maxEffectChain
	let originalMaxReaction: typeof reactiveOptions.maxEffectReaction

	beforeEach(() => {
		originalMaxChain = reactiveOptions.maxEffectChain
		originalMaxReaction = reactiveOptions.maxEffectReaction
		// Lower limit so the loop fails fast and we don't wait 2000 iterations
		reactiveOptions.maxEffectChain = 30
		reactiveOptions.maxEffectReaction = 'throw'
	})

	afterEach(() => {
		reactiveOptions.maxEffectChain = originalMaxChain
		reactiveOptions.maxEffectReaction = originalMaxReaction
		reset()
	})

	async function setupHive() {
		const engine = new TestEngine({
			boardSize: 12,
			terrainSeed: 1234,
			characterCount: 0,
		})
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
		const { game } = engine
		const gather = game.hex.getTile({ q: 0, r: 0 })!.content!
		const woodpile = game.hex.getTile({ q: 1, r: 0 })!.content!
		return { engine, game, gather, woodpile, hive: gather.hive! }
	}

	/**
	 * Test 1: Quantify the loop — does it keep growing per microtask drain?
	 */
	it('advertise fires grow unboundedly per microtask drain (loop confirmed)', async () => {
		const { gather, woodpile } = await setupHive()

		const counts: Array<{ gather: number; woodpile: number }> = []
		let gatherCount = 0
		let woodpileCount = 0

		const origAdvertise = gather.hive!.advertise.bind(gather.hive!)
		gather.hive!.advertise = (alveolus: any, ads: any) => {
			if (alveolus === gather) gatherCount++
			if (alveolus === woodpile) woodpileCount++
			return origAdvertise(alveolus, ads)
		}

		gather.storage!.addGood('wood', 5)

		// Sample advertise counts across 5 microtask drains
		for (let i = 0; i < 5; i++) {
			const snap = { gather: gatherCount, woodpile: woodpileCount }
			await new Promise((r) => setTimeout(r, 0))
			counts.push({
				gather: gatherCount - snap.gather,
				woodpile: woodpileCount - snap.woodpile,
			})
		}

		console.log('Advertise fires per drain cycle:', counts)
		// If the loop is truly unbounded, later counts will be much higher than earlier ones
		// (or the reactive system will throw before we get there)
		// We expect: fires should stabilise at 0 after the first movement is created
		const totalGather = counts.reduce((s, c) => s + c.gather, 0)
		console.log('Total gather advertise fires after 5 drains:', totalGather)
		expect(totalGather).toBeLessThanOrEqual(4)
	})

	/**
	 * Test 2: Does reserve() alone (outside createMovement) re-fire the advertise effect?
	 * This isolates whether the dependency is gather.storage._reserved -> gather.goodsRelations.
	 */
	it('reserve() on gather storage should NOT invalidate gather.goodsRelations', async () => {
		const { gather } = await setupHive()

		// Seed so there's something to reserve
		gather.storage!.addGood('wood', 5)
		// Drain microtasks from the initial advertisement
		await new Promise((r) => setTimeout(r, 10))

		let gatherFiresAfterReserve = 0
		const origAdvertise = gather.hive!.advertise.bind(gather.hive!)
		gather.hive!.advertise = (alveolus: any, ads: any) => {
			if (alveolus === gather) gatherFiresAfterReserve++
			return origAdvertise(alveolus, ads)
		}

		// Manually call reserve() — this is what createMovement does
		const token = gather.storage!.reserve({ wood: 1 }, 'diagnostic-test')

		// Drain
		await new Promise((r) => setTimeout(r, 10))

		console.log('gather advertise fires after manual reserve():', gatherFiresAfterReserve)
		token.cancel()

		// reserve() should NOT cause gather.goodsRelations to change and re-fire advertise
		expect(gatherFiresAfterReserve).toBe(0)
	})

	/**
	 * Test 3: Does woodpile.storage.allocate() re-fire woodpile advertise effect?
	 */
	it('allocate() on woodpile storage should NOT re-fire woodpile advertise effect', async () => {
		const { gather, woodpile } = await setupHive()

		await new Promise((r) => setTimeout(r, 10))

		let woodpileFiresAfterAllocate = 0
		const origAdvertise = gather.hive!.advertise.bind(gather.hive!)
		gather.hive!.advertise = (alveolus: any, ads: any) => {
			if (alveolus === woodpile) woodpileFiresAfterAllocate++
			return origAdvertise(alveolus, ads)
		}

		const token = woodpile.storage!.allocate({ wood: 1 }, 'diagnostic-test')
		await new Promise((r) => setTimeout(r, 10))

		console.log('woodpile advertise fires after manual allocate():', woodpileFiresAfterAllocate)
		token.cancel()

		expect(woodpileFiresAfterAllocate).toBe(0)
	})

	/**
	 * Test 5: Does createMovement() itself trigger a loop?
	 * Seed gather with wood, let the first movement be created, count re-fires.
	 */
	it('createMovement() should not cause advertise to re-fire', async () => {
		const { gather, woodpile, hive } = await setupHive()

		gather.storage!.addGood('wood', 5)
		// Let the initial advertisement + first createMovement microtask run
		await new Promise((r) => setTimeout(r, 10))

		// Now count fires during a second createMovement
		let gatherFires = 0
		let woodpileFires = 0
		const origAdvertise = hive.advertise.bind(hive)
		hive.advertise = (alveolus: any, ads: any) => {
			if (alveolus === gather) gatherFires++
			if (alveolus === woodpile) woodpileFires++
			return origAdvertise(alveolus, ads)
		}

		// Directly call createMovement (bypassing microtask)
		const result = (hive as any).createMovement('wood', gather, woodpile)
		console.log('createMovement result:', result)

		await new Promise((r) => setTimeout(r, 10))

		console.log(
			'Advertise fires after createMovement — gather:',
			gatherFires,
			'woodpile:',
			woodpileFires
		)
		expect(gatherFires).toBeLessThanOrEqual(1)
		expect(woodpileFires).toBeLessThanOrEqual(1)
	})

	/**
	 * Test 6: Verify slot.reserved is NOT reactive (does not trigger effects when written)
	 */
	it('slot.reserved writes should NOT trigger reactive effects', async () => {
		const { gather } = await setupHive()
		gather.storage!.addGood('wood', 3)
		await new Promise((r) => setTimeout(r, 10))

		const storage = gather.storage as SlottedStorage
		const slot = storage.slots.find((s) => s !== undefined)!
		expect(slot).toBeDefined()

		let effectFired = 0
		const cleanup = effect`test:planner-slot-reserved`(() => {
			void slot.reserved
			effectFired++
		})
		// effect fires once on setup
		expect(effectFired).toBe(1)

		// Now write to slot.reserved — should NOT re-fire effect
		slot.reserved += 1
		await new Promise((r) => setTimeout(r, 0))
		console.log('Effect fires after slot.reserved write:', effectFired)
		expect(effectFired).toBe(1) // unchanged

		cleanup()
	})

	/**
	 * Test 7: Verify slot.allocated is NOT reactive (SlottedStorage)
	 */
	it('slot.allocated writes should NOT trigger reactive effects', async () => {
		const { gather } = await setupHive()
		// gather uses SlottedStorage
		const storage = gather.storage as SlottedStorage
		gather.storage!.addGood('wood', 3)
		const token = storage.allocate({ wood: 1 }, 'test')
		await new Promise((r) => setTimeout(r, 10))

		const slot = storage.slots.find((s) => s !== undefined)!
		expect(slot).toBeDefined()

		let effectFired = 0
		const cleanup = effect`test:planner-slot-allocated`(() => {
			void slot.allocated
			effectFired++
		})
		expect(effectFired).toBe(1)

		slot.allocated += 1
		await new Promise((r) => setTimeout(r, 0))
		console.log('Effect fires after slot.allocated write:', effectFired)
		expect(effectFired).toBe(1)

		cleanup()
		token.cancel()
	})

	/**
	 * Test 8: Full tick cycle - does running engine.tick() with workers overflow?
	 */
	it('engine.tick with workers should not overflow effect chain', async () => {
		reactiveOptions.maxEffectChain = 30 // fail fast

		const engine = new TestEngine({
			boardSize: 12,
			terrainSeed: 1234,
			characterCount: 0,
		})
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
		const { game } = engine
		const gather = game.hex.getTile({ q: 0, r: 0 })!.content!

		// Seed gatherer with wood
		gather.storage!.addGood('wood', 5)
		await new Promise((r) => setTimeout(r, 0))

		// Set manual needs to trigger movement planning
		gather.hive!.manualNeeds = { wood: 50 }
		await new Promise((r) => setTimeout(r, 0))

		// Spawn a worker at the gatherer
		const worker = engine.spawnCharacter('TestWorker', { q: 0, r: 0 })
		worker.role = 'worker'
		void worker.scriptsContext
		const action = worker.findAction()
		if (action) worker.begin(action)

		await new Promise((r) => setTimeout(r, 0))

		// Run up to 100 ticks — should not throw
		let overflowActivations: any[] = []
		const origMaxReaction = reactiveOptions.maxEffectReaction
		reactiveOptions.maxEffectReaction = 'warn'
		try {
			for (let i = 0; i < 100; i++) {
				engine.tick(0.5)
				await new Promise((r) => setTimeout(r, 0))
			}
		} catch (e: any) {
			overflowActivations = getActivationLog()
				.filter(Boolean)
				.slice(-30)
				.map((entry: any) => ({
					effect: entry.effect?.name || 'anon',
					obj: entry.obj?.constructor?.name || String(entry.obj),
					prop: String(entry.prop),
				}))
			console.error('OVERFLOW activations:', JSON.stringify(overflowActivations, null, 2))
			throw e
		} finally {
			reactiveOptions.maxEffectReaction = origMaxReaction
		}
	})

	/**
	 * Test 4: Does writing to hive.movingGoods (via place()) re-fire advertise effects?
	 * movingGoods is read by aGoodMovement (memoized), but aGoodMovement is not in the
	 * goodsRelations dependency chain — so place() should NOT re-fire advertise effects.
	 */
	it('writing to movingGoods should NOT re-fire advertise effects', async () => {
		const { gather, woodpile, hive } = await setupHive()

		gather.storage!.addGood('wood', 5)
		await new Promise((r) => setTimeout(r, 10))

		let gatherFires = 0
		let woodpileFires = 0
		const origAdvertise = hive.advertise.bind(hive)
		hive.advertise = (alveolus: any, ads: any) => {
			if (alveolus === gather) gatherFires++
			if (alveolus === woodpile) woodpileFires++
			return origAdvertise(alveolus, ads)
		}

		// Directly write to movingGoods — simulates what place() does inside createMovement
		const coord = toAxialCoord(gather.tile.position)!
		if (!hive.movingGoods.has(coord)) hive.movingGoods.set(coord, [])
		hive.movingGoods.get(coord)!.push({ goodType: 'wood' } as any)

		await new Promise((r) => setTimeout(r, 10))

		console.log(
			'Advertise fires after movingGoods write — gather:',
			gatherFires,
			'woodpile:',
			woodpileFires
		)

		expect(gatherFires).toBe(0)
		expect(woodpileFires).toBe(0)
	})
})
