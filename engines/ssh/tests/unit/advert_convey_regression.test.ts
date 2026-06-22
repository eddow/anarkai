// @ts-nocheck
import type { Alveolus } from 'ssh/board/content/alveolus'
import { Commitment } from 'ssh/commitment/commitment'
import type { SaveState } from 'ssh/game'
import type { Hive, MovingGood } from 'ssh/hive/hive'
import { collectTileWorkPicks } from 'ssh/tile-work'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TestEngine } from '../test-engine'

async function flushDeferred(turns: number = 3) {
	for (let i = 0; i < turns; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0))
	}
}

function getWoodMovements(hive: Hive): MovingGood[] {
	return Array.from(hive.movingGoods.values()).flatMap((goods) =>
		goods.filter((movement) => movement.goodType === 'wood')
	)
}

describe('advert/convey regression', () => {
	let engine: TestEngine | undefined

	afterEach(async () => {
		await engine?.destroy()
		engine = undefined
	})

	it('reuses cached convey movement selection until a planning event invalidates it', {
		timeout: 30000,
	}, async () => {
		engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		const scenario: Partial<SaveState> = {
			hives: [
				{
					name: 'ConveyCacheHive',
					alveoli: [
						{ coord: [0, 0], alveolus: 'storage', goods: { wood: 1 } },
						{ coord: [1, 0], alveolus: 'storage', goods: {} },
					],
				},
			],
		}

		engine.loadScenario(scenario)
		await flushDeferred()

		const provider = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
		const demander = engine.game.hex.getTile({ q: 1, r: 0 })?.content as Alveolus | undefined
		const hive = provider?.hive as Hive | undefined
		expect(provider).toBeDefined()
		expect(demander).toBeDefined()
		expect(hive).toBeDefined()
		if (!provider || !demander || !hive) throw new Error('Expected convey cache hive')

		expect(hive.createMovement('wood', provider, demander)).toBe(true)
		const originalGet = hive.movingGoods.get.bind(hive.movingGoods)
		const getSpy = vi.fn(originalGet)
		hive.movingGoods.get = getSpy as typeof hive.movingGoods.get
		try {
			const first = provider.aGoodMovement
			const callsAfterFirstRead = getSpy.mock.calls.length
			const second = provider.aGoodMovement

			expect(first).toBeDefined()
			expect(second).toBe(first)
			expect(getSpy.mock.calls.length).toBe(callsAfterFirstRead)

			provider.storage.addGood('wood', 1)
			const third = provider.aGoodMovement

			expect(third).toBeDefined()
			expect(getSpy.mock.calls.length).toBeGreaterThan(callsAfterFirstRead)
		} finally {
			hive.movingGoods.get = originalGet as typeof hive.movingGoods.get
		}
	})

	it('reuses cached getJob results while collecting tile work for multiple characters', {
		timeout: 30000,
	}, async () => {
		engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		const scenario: Partial<SaveState> = {
			hives: [
				{
					name: 'TileWorkCacheHive',
					alveoli: [
						{ coord: [0, 0], alveolus: 'storage', goods: { wood: 1 } },
						{ coord: [1, 0], alveolus: 'storage', goods: {} },
					],
				},
			],
		}

		engine.loadScenario(scenario)
		await flushDeferred()

		const provider = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
		const demander = engine.game.hex.getTile({ q: 1, r: 0 })?.content as Alveolus | undefined
		const hive = provider?.hive as Hive | undefined
		expect(provider).toBeDefined()
		expect(demander).toBeDefined()
		expect(hive).toBeDefined()
		if (!provider || !demander || !hive) throw new Error('Expected tile work cache hive')

		const assigned = engine.spawnCharacter('Assigned', { q: 0, r: 0 })
		engine.spawnCharacter('Other A', { q: -1, r: 0 })
		engine.spawnCharacter('Other B', { q: 0, r: -1 })
		provider.assignedWorker = assigned
		assigned.assignedAlveolus = provider
		expect(hive.createMovement('wood', provider, demander)).toBe(true)

		const originalGet = hive.movingGoods.get.bind(hive.movingGoods)
		const getSpy = vi.fn(originalGet)
		hive.movingGoods.get = getSpy as typeof hive.movingGoods.get
		try {
			const first = collectTileWorkPicks(engine.game, provider.tile)
			const callsAfterFirstCollect = getSpy.mock.calls.length
			const second = collectTileWorkPicks(engine.game, provider.tile)

			expect(first.some((choice) => choice.job.job === 'convey')).toBe(true)
			expect(second.some((choice) => choice.job.job === 'convey')).toBe(true)
			expect(getSpy.mock.calls.length).toBe(callsAfterFirstCollect)
		} finally {
			hive.movingGoods.get = originalGet as typeof hive.movingGoods.get
		}
	})

	it('does not keep scheduling 2-use wood once that need is already covered in flight', {
		timeout: 30000,
	}, async () => {
		engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		const scenario: Partial<SaveState> = {
			hives: [
				{
					name: 'RegressionHive',
					alveoli: [
						{ coord: [0, 0], alveolus: 'tree_chopper', goods: { wood: 2 } },
						{ coord: [1, 0], alveolus: 'sawmill', goods: { wood: 1 } },
						{
							coord: [1, -1],
							alveolus: 'woodpile',
							goods: {},
							configuration: {
								ref: { scope: 'individual' },
								individual: {
									working: true,
									buffers: { wood: 1 },
								},
							},
						},
					],
				},
			],
		}

		engine.loadScenario(scenario)
		await flushDeferred()

		const provider = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
		const sawmill = engine.game.hex.getTile({ q: 1, r: 0 })?.content as Alveolus | undefined
		const woodpile = engine.game.hex.getTile({ q: 1, r: -1 })?.content as Alveolus | undefined
		const hive = provider?.hive as Hive | undefined
		expect(provider).toBeDefined()
		expect(sawmill).toBeDefined()
		expect(woodpile).toBeDefined()
		expect(hive).toBeDefined()
		if (!provider || !sawmill || !woodpile || !hive) {
			throw new Error('Expected regression hive to be created')
		}

		const firstMovement = getWoodMovements(hive).find((movement) => movement.demander === sawmill)
		expect(firstMovement).toBeDefined()
		if (!firstMovement) {
			throw new Error('Expected an initial wood movement to the sawmill')
		}

		const initialWoodpileMovement = getWoodMovements(hive).find(
			(movement) => movement.demander === woodpile
		)
		if (initialWoodpileMovement) {
			expect(hive.needs.wood).toBeUndefined()
		} else {
			expect(hive.needs.wood).toBe('1-buffer')
		}

		firstMovement.claimed = true
		firstMovement.claimedBy = 'advert-convey-regression'
		firstMovement.claimedAtMs = Date.now()
		firstMovement.hop()
		const firstHopSource = new Commitment('advert-convey-regression.first-hop')
		hive.bindMovementsSourceToHopStep(
			[firstMovement],
			firstHopSource,
			'advert-convey-regression.first-hop'
		)
		await flushDeferred()

		const nextMovements = getWoodMovements(hive)
		const movementsToSawmill = nextMovements.filter(
			(movement) => movement.demander === sawmill && movement !== firstMovement
		)
		const movementsToWoodpile = nextMovements.filter((movement) => movement.demander === woodpile)

		expect(movementsToSawmill).toHaveLength(0)
		expect(movementsToWoodpile.length).toBeGreaterThan(0)

		const woodpileMovement = initialWoodpileMovement ?? movementsToWoodpile[0]
		expect(woodpileMovement).toBeDefined()
		if (!woodpileMovement) throw new Error('Expected a wood movement to the woodpile')
		const releaseClaim = (movement: {
			claimed?: boolean
			claimedBy?: string
			claimedAtMs?: number
		}) => {
			movement.claimed = false
			delete movement.claimedBy
			delete movement.claimedAtMs
		}
		releaseClaim(firstMovement)
		firstMovement.finish()
		releaseClaim(woodpileMovement)
		woodpileMovement.finish()
		await flushDeferred()

		const remainingMovements = getWoodMovements(hive)
		expect(remainingMovements.filter((movement) => movement.demander === sawmill)).toHaveLength(0)
		expect(sawmill.storage.stock.wood).toBe(2)
		expect(woodpile.storage.stock.wood).toBe(1)
	})

	it('reschedules sawmill demand after input stock is consumed', {
		timeout: 30000,
	}, async () => {
		engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		const scenario: Partial<SaveState> = {
			hives: [
				{
					name: 'ConsumptionDemandHive',
					alveoli: [
						{ coord: [0, 0], alveolus: 'tree_chopper', goods: {} },
						{ coord: [1, 0], alveolus: 'sawmill', goods: { wood: 2 } },
					],
				},
			],
		}

		engine.loadScenario(scenario)
		await flushDeferred()

		const provider = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
		const sawmill = engine.game.hex.getTile({ q: 1, r: 0 })?.content as Alveolus | undefined
		const hive = provider?.hive as Hive | undefined
		expect(provider).toBeDefined()
		expect(sawmill).toBeDefined()
		expect(hive).toBeDefined()
		if (!provider || !sawmill || !hive) throw new Error('Expected provider/sawmill hive')

		expect(getWoodMovements(hive).filter((movement) => movement.demander === sawmill)).toHaveLength(
			0
		)

		provider.storage.addGood('wood', 1)
		await flushDeferred()

		expect(getWoodMovements(hive).filter((movement) => movement.demander === sawmill)).toHaveLength(
			0
		)

		expect(sawmill.storage.removeGood('wood', 1)).toBe(1)
		await flushDeferred()

		expect(getWoodMovements(hive).filter((movement) => movement.demander === sawmill)).toHaveLength(
			1
		)
	})

	it('reschedules advertisements when an alveolus starts working', {
		timeout: 30000,
	}, async () => {
		engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		const scenario: Partial<SaveState> = {
			hives: [
				{
					name: 'WorkingInvalidationHive',
					alveoli: [
						{ coord: [0, 0], alveolus: 'tree_chopper', goods: { wood: 1 } },
						{
							coord: [1, 0],
							alveolus: 'sawmill',
							goods: {},
							configuration: {
								ref: { scope: 'individual' },
								individual: { working: false },
							},
						},
					],
				},
			],
		}

		engine.loadScenario(scenario)
		await flushDeferred()

		const provider = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
		const sawmill = engine.game.hex.getTile({ q: 1, r: 0 })?.content as Alveolus | undefined
		const hive = provider?.hive as Hive | undefined
		if (!provider || !sawmill || !hive) throw new Error('Expected provider/sawmill hive')

		expect(getWoodMovements(hive).filter((movement) => movement.demander === sawmill)).toHaveLength(
			0
		)

		sawmill.working = true
		await flushDeferred()

		expect(getWoodMovements(hive).filter((movement) => movement.demander === sawmill)).toHaveLength(
			1
		)
	})

	it('reschedules advertisements when storage buffers change', {
		timeout: 30000,
	}, async () => {
		engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		const scenario: Partial<SaveState> = {
			hives: [
				{
					name: 'BufferInvalidationHive',
					alveoli: [
						{ coord: [0, 0], alveolus: 'tree_chopper', goods: {} },
						{
							coord: [1, 0],
							alveolus: 'woodpile',
							goods: {},
							configuration: {
								ref: { scope: 'individual' },
								individual: { working: true, buffers: { wood: 0 } },
							},
						},
					],
				},
			],
		}

		engine.loadScenario(scenario)
		await flushDeferred()

		const provider = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
		const woodpile = engine.game.hex.getTile({ q: 1, r: 0 })?.content as
			| (Alveolus & { setBuffers(buffers: Record<string, number>): void })
			| undefined
		const hive = provider?.hive as Hive | undefined
		if (!provider || !woodpile || !hive) throw new Error('Expected provider/woodpile hive')

		expect(
			getWoodMovements(hive).filter((movement) => movement.demander === woodpile)
		).toHaveLength(0)
		expect(hive.needs.wood).toBeUndefined()

		woodpile.setBuffers({ wood: 1 })
		await flushDeferred()

		expect(hive.needs.wood).toBe('1-buffer')
		expect(
			getWoodMovements(hive).filter((movement) => movement.demander === woodpile)
		).toHaveLength(0)

		provider.storage.addGood('wood', 1)
		await flushDeferred()

		expect(
			getWoodMovements(hive).filter((movement) => movement.demander === woodpile)
		).toHaveLength(1)
	})
})
