// @ts-nocheck
import { queryTileBlocking, transformStallReasons } from 'ssh/board/blocking-details'
import { TransformAlveolus } from 'ssh/hive/transform'
import { Deposit, UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { createAlveolus } from 'ssh/hive'
import { gatherFreightLine } from '../freight-fixtures'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('queryTileBlocking', () => {
	it('reports deposit composition', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		try {
			const game = engine.game
			const tile = game.hex.getTile({ q: 0, r: 0 })!
			const deposit = Deposit.create('tree', 7)
			if (!deposit) throw new Error('tree deposit missing')
			game.hex.setTileContent(tile, new UnBuiltLand(tile, 'forest', deposit))

			const entries = queryTileBlocking(tile)
			expect(entries).toHaveLength(1)
			expect(entries[0]).toMatchObject({ kind: 'deposit', depositType: 'tree', amount: 7 })
		} finally {
			await engine.destroy()
		}
	})

	it('groups loose goods by type with available counts', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		try {
			const game = engine.game
			const tile = game.hex.getTile({ q: 0, r: 1 })!
			game.hex.looseGoods.add(tile, 'wood', { position: tile.position })
			game.hex.looseGoods.add(tile, 'wood', { position: tile.position })
			const reserved = game.hex.looseGoods.add(tile, 'stone', { position: tile.position })
			reserved.available = false

			const entries = queryTileBlocking(tile)
			const wood = entries.find((e) => e.kind === 'loose-good' && e.goodType === 'wood')
			const stone = entries.find((e) => e.kind === 'loose-good' && e.goodType === 'stone')
			expect(wood).toMatchObject({ kind: 'loose-good', goodType: 'wood', count: 2, available: 2 })
			expect(stone).toMatchObject({
				kind: 'loose-good',
				goodType: 'stone',
				count: 1,
				available: 0,
			})
		} finally {
			await engine.destroy()
		}
	})

	it('reports idle vehicles but skips docked line service', async () => {
		const engine = new TestEngine({ terrainSeed: 9511, characterCount: 0 })
		await engine.init()
		try {
			const game = engine.game
			const idleTile = game.hex.getTile({ q: 0, r: 0 })!
			const vehicle = game.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 })

			const idleEntries = queryTileBlocking(idleTile)
			const vehicleEntry = idleEntries.find((e) => e.kind === 'vehicle')
			expect(vehicleEntry).toMatchObject({
				kind: 'vehicle',
				vehicleType: 'wheelbarrow',
				docked: false,
			})
			if (vehicleEntry?.kind === 'vehicle') expect(vehicleEntry.vehicle).toBe(vehicle)

			// Docked line-service vehicles do not burden, so they are skipped.
			const line = gatherFreightLine({
				name: 'Docked line',
				hiveName: 'BurdenBay',
				coord: [1, 0],
				filters: ['wood'],
				radius: 2,
			})
			const dockTile = game.hex.getTile({ q: 1, r: 0 })!
			const docked = game.vehicles.createVehicle('wheelbarrow', { q: 1, r: 0 }, [line])
			const character = game.population.createCharacter('Docked', { q: 1, r: 0 })
			docked.beginService(line, line.stops[1]!, character)
			docked.dock()
			expect(queryTileBlocking(dockTile).some((e) => e.kind === 'vehicle')).toBe(false)
		} finally {
			await engine.destroy()
		}
	})

	it('is empty on a clear tile', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		try {
			const tile = engine.game.hex.getTile({ q: 0, r: 0 })!
			if (tile.content instanceof UnBuiltLand) tile.content.deposit = undefined
			expect(queryTileBlocking(tile)).toEqual([])
		} finally {
			await engine.destroy()
		}
	})
})

describe('transformStallReasons', () => {
	async function withSawmill(goods: Record<string, number>) {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		engine.loadScenario({
			hives: [
				{
					name: 'TransformStall',
					alveoli: [{ coord: [0, 0], alveolus: 'sawmill', goods }],
				},
			],
		})
		await Promise.resolve()
		const sawmill = engine.game.hex.getTile({ q: 0, r: 0 })?.content
		if (!(sawmill instanceof TransformAlveolus)) {
			throw new Error(`expected sawmill, got ${sawmill?.constructor?.name ?? 'nothing'}`)
		}
		return { engine, sawmill }
	}

	it('returns empty when the transform can work', async () => {
		const { engine, sawmill } = await withSawmill({ wood: 1 })
		try {
			expect(transformStallReasons(sawmill)).toEqual([])
		} finally {
			await engine.destroy()
		}
	})

	it('reports noOutputRoom when the output buffer is full', async () => {
		const { engine, sawmill } = await withSawmill({ wood: 1, planks: 3 })
		try {
			sawmill.setProcessBuffer('planks', 1)
			expect(transformStallReasons(sawmill)).toContain('noOutputRoom')
		} finally {
			await engine.destroy()
		}
	})

	it('reports productRatioLimit when the configured ratio is reached', async () => {
		const { engine, sawmill } = await withSawmill({ wood: 1, planks: 1 })
		try {
			sawmill.setProductRatioConfiguration({
				inputGood: 'wood',
				outputGood: 'planks',
				maxProductRatio: 0.5,
			})
			expect(transformStallReasons(sawmill)).toContain('productRatioLimit')
		} finally {
			await engine.destroy()
		}
	})

	it('reports noInputGood when input stock is missing', async () => {
		const { engine, sawmill } = await withSawmill({})
		try {
			expect(transformStallReasons(sawmill)).toContain('noInputGood')
		} finally {
			await engine.destroy()
		}
	})

	it('reports both input and output blocks at once', async () => {
		const { engine, sawmill } = await withSawmill({ planks: 3 })
		try {
			sawmill.setProcessBuffer('planks', 1)
			const reasons = transformStallReasons(sawmill)
			expect(reasons).toContain('noOutputRoom')
			expect(reasons).toContain('noInputGood')
			expect(reasons.indexOf('noOutputRoom')).toBeLessThan(reasons.indexOf('noInputGood'))
		} finally {
			await engine.destroy()
		}
	})

	it('returns empty for a non-working transform', async () => {
		const { engine, sawmill } = await withSawmill({})
		try {
			sawmill.configurationRef = { scope: 'individual' }
			sawmill.individualConfiguration = { working: false }
			expect(transformStallReasons(sawmill)).toEqual([])
		} finally {
			await engine.destroy()
		}
	})

	it('matches the browser single-warning order', async () => {
		// Browser order: output room → ratio limit → input good → no work.
		const { engine, sawmill } = await withSawmill({ wood: 1, planks: 1 })
		try {
			sawmill.setProductRatioConfiguration({
				inputGood: 'wood',
				outputGood: 'planks',
				maxProductRatio: 0.5,
			})
			sawmill.storage.removeGood('wood', 1)
			const reasons = transformStallReasons(sawmill)
			expect(reasons[0]).toBe('productRatioLimit')
			expect(reasons).toContain('noInputGood')
		} finally {
			await engine.destroy()
		}
	})

	it('createAlveolus import keeps the plan wiring honest', () => {
		expect(typeof createAlveolus).toBe('function')
	})
})
