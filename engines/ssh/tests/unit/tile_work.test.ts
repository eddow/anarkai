// @ts-nocheck
import { createAlveolus } from 'ssh/hive'
import { collectTileWorkPicks } from 'ssh/tile-work'
import { axial, toAxialCoord } from 'ssh/utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TestEngine } from '../test-engine/engine'

describe('tile work picks', () => {
	let engine: TestEngine | undefined

	afterEach(async () => {
		await engine?.destroy()
		engine = undefined
	})

	async function setupEngine(): Promise<TestEngine> {
		const next = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await next.init()
		engine = next
		return next
	}

	it('includes direct jobs offered by the selected alveolus tile', async () => {
		const testEngine = await setupEngine()
		const game = testEngine.game
		const worker = game.population.createCharacter('Worker', { q: 0, r: 0 })
		const tile = game.hex.getTile({ q: 0, r: 1 })
		if (!tile) throw new Error('test setup missing sawmill tile')

		const sawmill = createAlveolus('sawmill', tile)
		if (!sawmill) throw new Error('sawmill alveolus missing')
		tile.content = sawmill
		sawmill.storage.addGood('wood', 1)

		const choices = collectTileWorkPicks(game, tile)
		const transform = choices.find((choice) => choice.job.job === 'transform')

		expect(transform).toBeDefined()
		expect(transform?.source).toBe('tile')
		expect(transform?.character.uid).toBe(worker.uid)
		expect(transform?.targetTile).toBe(tile)
	})

	it('does not include direct alveolus jobs while the tile carries loose goods', async () => {
		const testEngine = await setupEngine()
		const game = testEngine.game
		game.population.createCharacter('Worker', { q: 0, r: 0 })
		const tile = game.hex.getTile({ q: 0, r: 1 })
		if (!tile) throw new Error('test setup missing sawmill tile')

		const sawmill = createAlveolus('sawmill', tile)
		if (!sawmill) throw new Error('sawmill alveolus missing')
		tile.content = sawmill
		sawmill.storage.addGood('wood', 1)
		game.hex.looseGoods.add(tile, 'stone', { position: tile.position })

		expect(tile.isBurdened).toBe(true)
		expect(tile.getJob()).toBeUndefined()
		expect(collectTileWorkPicks(game, tile).some((choice) => choice.source === 'tile')).toBe(false)
	})

	it('does not include direct alveolus jobs while the tile is burdened by a vehicle', async () => {
		const testEngine = await setupEngine()
		const game = testEngine.game
		game.population.createCharacter('Worker', { q: 0, r: 0 })
		const tile = game.hex.getTile({ q: 0, r: 1 })
		if (!tile) throw new Error('test setup missing sawmill tile')

		const sawmill = createAlveolus('sawmill', tile)
		if (!sawmill) throw new Error('sawmill alveolus missing')
		tile.content = sawmill
		sawmill.storage.addGood('wood', 1)
		game.vehicles.createVehicle('barrow-on-sawmill', 'wheelbarrow', tile.position)

		expect(tile.isBurdened).toBe(true)
		expect(tile.getJob()).toBeUndefined()
		expect(collectTileWorkPicks(game, tile).some((choice) => choice.source === 'tile')).toBe(false)
	})

	it('includes direct alveolus jobs when the worker path start is sub-hex (rounded like pathfinding)', async () => {
		const testEngine = await setupEngine()
		const game = testEngine.game
		const worker = game.population.createCharacter('Worker', { q: 0, r: 0 })
		worker.position = { q: 0.14, r: 0.09 }
		const rounded = axial.round(toAxialCoord(worker.position)!)
		expect(rounded).toEqual({ q: 0, r: 0 })
		const tile = game.hex.getTile({ q: 0, r: 1 })
		if (!tile) throw new Error('test setup missing sawmill tile')

		const sawmill = createAlveolus('sawmill', tile)
		if (!sawmill) throw new Error('sawmill alveolus missing')
		tile.content = sawmill
		sawmill.storage.addGood('wood', 1)

		const choices = collectTileWorkPicks(game, tile)
		const transform = choices.find((choice) => choice.job.job === 'transform')

		expect(transform).toBeDefined()
		expect(transform?.source).toBe('tile')
		expect(transform?.character.uid).toBe(worker.uid)
	})

	it('reuses cached tile work choices and pathfinding until work planning changes', async () => {
		const testEngine = await setupEngine()
		const game = testEngine.game
		game.population.createCharacter('Worker', { q: 0, r: 0 })
		const tile = game.hex.getTile({ q: 0, r: 1 })
		if (!tile) throw new Error('test setup missing sawmill tile')

		const sawmill = createAlveolus('sawmill', tile)
		if (!sawmill) throw new Error('sawmill alveolus missing')
		tile.content = sawmill
		sawmill.storage.addGood('wood', 1)

		const findPathSpy = vi.spyOn(game.hex, 'findPathForCharacter')
		const first = collectTileWorkPicks(game, tile)
		const callsAfterFirst = findPathSpy.mock.calls.length
		const second = collectTileWorkPicks(game, tile)

		expect(first).toBe(second)
		expect(findPathSpy.mock.calls.length).toBe(callsAfterFirst)

		game.invalidateWorkPlanning('test')
		const third = collectTileWorkPicks(game, tile)

		expect(third).not.toBe(first)
		expect(findPathSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst)
	})

	it('includes vehicle offload jobs whose target coordinate is the selected tile', async () => {
		const testEngine = await setupEngine()
		const game = testEngine.game
		const targetTile = game.hex.getTile({ q: 1, r: 0 })
		if (!targetTile) throw new Error('test setup missing target tile')
		const worker = game.population.createCharacter('Worker', { q: 1, r: 0 })
		const vehicle = game.vehicles.createVehicle('barrow-1', 'wheelbarrow', { q: 1, r: 0 })

		targetTile.zone = 'residential'
		const looseGood = game.hex.looseGoods.add(targetTile, 'stone', {
			position: targetTile.position,
		})
		vehicle.beginMaintenanceService({
			kind: 'loadFromBurden',
			looseGood,
			targetCoord: { q: 1, r: 0 },
		})

		const choices = collectTileWorkPicks(game, targetTile)
		const offload = choices.find(
			(choice) => choice.source === 'vehicle' && choice.job.job === 'vehicleOffload'
		)

		expect(offload).toBeDefined()
		expect(offload?.character.uid).toBe(worker.uid)
		expect(offload?.vehicle?.uid).toBe(vehicle.uid)
		if (offload?.job.job !== 'vehicleOffload') throw new Error('expected vehicleOffload pick')
		expect(offload.job.maintenanceKind).toBe('loadFromBurden')
		expect(offload.job.targetCoord).toEqual({ q: 1, r: 0 })
	})

	it('does not show vehicle work on a tile unless the job target points at that tile', async () => {
		const testEngine = await setupEngine()
		const game = testEngine.game
		const targetTile = game.hex.getTile({ q: 1, r: 0 })
		const otherTile = game.hex.getTile({ q: 0, r: 0 })
		if (!targetTile || !otherTile) throw new Error('test setup missing target tiles')
		game.population.createCharacter('Worker', { q: 1, r: 0 })
		const vehicle = game.vehicles.createVehicle('barrow-1', 'wheelbarrow', { q: 1, r: 0 })

		targetTile.zone = 'residential'
		const looseGood = game.hex.looseGoods.add(targetTile, 'stone', {
			position: targetTile.position,
		})
		vehicle.beginMaintenanceService({
			kind: 'loadFromBurden',
			looseGood,
			targetCoord: { q: 1, r: 0 },
		})

		const choices = collectTileWorkPicks(game, otherTile)

		expect(
			choices.some(
				(choice) =>
					choice.source === 'vehicle' &&
					choice.job.job === 'vehicleOffload' &&
					choice.vehicle?.uid === vehicle.uid
			)
		).toBe(false)
	})
})
