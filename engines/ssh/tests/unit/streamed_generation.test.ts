import { Game } from 'ssh/game/game'
import { BoardGenerator, GameGenerator, type GameGenerationConfig } from 'ssh/generation'
import { axial } from 'ssh/utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('ssh/assets/resources', () => ({ resources: {}, prefix: '' }))
vi.mock('ssh/assets/game-content', () => ({
	vehicles: { 'by-hands': { storage: { slots: 10, capacity: 100 } } },
	goods: {},
	terrain: new Proxy({}, { get: () => ({ walkTime: 1, generation: { deposits: {} } }) }),
	deposits: {},
	alveoli: {},
	configurations: {
		'specific-storage': { working: true, buffers: {} },
		default: { working: true },
	},
}))

describe('streamed region generation', () => {
	const games = new Set<Game>()

	afterEach(() => {
		for (const game of games) game.destroy()
		games.clear()
	})

	it('matches full-board terrain for river-influenced coords', () => {
		const generator = new GameGenerator()
		const boardSize = 12
		const config: GameGenerationConfig = {
			terrainSeed: 42,
			characterCount: 0,
		}
		const full = generator.generateRegion(config, [...axial.enum(boardSize - 1)])
		const coord = full.find(
			(tile) =>
				tile.hydrology?.isChannel || Object.keys(tile.hydrology?.edges ?? {}).length > 0
		)?.coord
		expect(coord).toBeDefined()
		if (!coord) throw new Error('Expected hydrology-bearing tile')
		const streamedRegion = generator.generateRegion(config, [...axial.allTiles(coord, 8)])
		const streamed = streamedRegion.filter((tile) => tile.coord.q === coord.q && tile.coord.r === coord.r)

		const fullTile = full.find((tile) => tile.coord.q === coord.q && tile.coord.r === coord.r)
		expect(fullTile).toBeDefined()
		expect(streamed).toHaveLength(1)
		expect(streamed[0]!.terrain).toBe(fullTile!.terrain)
		expect(streamed[0]!.height).toBe(fullTile!.height)
		expect(streamed[0]!.hydrology).toEqual(fullTile!.hydrology)
	})

	it('preserves highland terrain under river-bank biomes', () => {
		const tiles = new Map([
			[
				'0,0',
				{
					height: 0.2,
					temperature: 0,
					humidity: 0,
					terrainType: 0,
					rockyNoise: 0,
					sediment: 0,
					waterTable: 0,
				},
			],
		])
		const biomes = new Map([['0,0', 'river-bank' as const]])
		const snapshot = {
			seed: 1,
			tiles,
			edges: new Map(),
			biomes,
			hydrology: {
				banks: new Map(),
				channels: new Set(),
				channelInfluence: new Map(),
			},
		}

		const [tile] = new BoardGenerator().generateBoard(snapshot)
		expect(tile?.terrain).toBe('snow')
	})

	it('returns hydrology metadata from render terrain samples', async () => {
		const generator = new GameGenerator()
		const generated = generator.generateRegion(
			{ terrainSeed: 42, characterCount: 0 },
			[...axial.enum(11)]
		)
		const coord = generated.find(
			(tile) =>
				tile.hydrology?.isChannel || Object.keys(tile.hydrology?.edges ?? {}).length > 0
		)?.coord
		expect(coord).toBeDefined()
		if (!coord) throw new Error('Expected hydrology-bearing coord')

		const game = new Game({
			terrainSeed: 42,
			characterCount: 0,
		})
		games.add(game)
		await game.loaded

		await game.ensureTerrainSamples(axial.allTiles(coord, 8))
		const sample = game.getTerrainSample(coord)
		expect(sample?.hydrology).toBeDefined()
		expect(sample?.hydrology?.isChannel || (sample?.hydrology?.bankInfluence ?? 0) > 0).toBe(true)
	})

	it('applies the river walk-time multiplier only on channel tiles', async () => {
		const game = new Game({
			terrainSeed: 42,
			characterCount: 0,
		})
		games.add(game)
		await game.loaded

		game.generate(
			{ terrainSeed: 42, characterCount: 0 },
			{ tiles: [{ coord: [2, 3], terrain: 'grass', height: 0.1 }] }
		)
		const tile = game.hex.getTile({ q: 2, r: 3 })
		expect(tile?.effectiveWalkTime).toBe(1)
		if (!tile) throw new Error('Expected tile to exist')

		tile.terrainHydrology = {
			isChannel: true,
			edges: {
				0: { flux: 12, width: 4, depth: 2 },
			},
		}

		expect(tile.riverWalkTimeMultiplier).toBe(2)
		expect(tile.effectiveWalkTime).toBe(2)
	})

	it('coalesces overlapping gameplay frontier requests without duplicating in-flight coords', async () => {
		const game = new Game({
			terrainSeed: 77,
			characterCount: 0,
		})
		games.add(game)
		await game.loaded

		let release: (() => void) | undefined
		const firstBatchStarted = new Promise<void>((resolve) => {
			release = resolve
		})
		const generateRegionAsync = vi
			.spyOn(game.generator, 'generateRegionAsync')
			.mockImplementation(async (_config, coords) => {
				const materialized = [...coords].map((coord) => ({
					coord,
					terrain: 'grass' as const,
					height: 0,
					goods: {},
					walkTime: 3,
				}))
				if (generateRegionAsync.mock.calls.length === 1) {
					await firstBatchStarted
				}
				return materialized
			})

		const first = game.requestGameplayFrontier({ q: 10, r: 0 }, 2, { maxBatchSize: 19 })
		const second = game.requestGameplayFrontier({ q: 10, r: 0 }, 2, { maxBatchSize: 19 })
		await Promise.resolve()
		expect(generateRegionAsync).toHaveBeenCalledTimes(1)

		release?.()
		await Promise.all([first, second])

		expect(generateRegionAsync).toHaveBeenCalledTimes(1)
		expect(game.hex.getTileContent({ q: 10, r: 0 })).toBeDefined()
	})

	it('publishes streamed tile objects as one batched objectsAdded event', async () => {
		const game = new Game({
			terrainSeed: 78,
			characterCount: 0,
		})
		games.add(game)
		await game.loaded

		const batches: string[][] = []
		game.on({
			objectsAdded: (objects) => {
				batches.push(objects.map((object) => object.uid).sort())
			},
		})

		const generateRegionAsync = vi
			.spyOn(game.generator, 'generateRegionAsync')
			.mockImplementation(async (_config, coords) =>
				[...coords].map((coord) => ({
					coord,
					terrain: 'grass' as const,
					height: 0,
					goods: {},
					walkTime: 3,
				}))
			)

		const generated = await game.requestGameplayFrontier({ q: 4, r: -1 }, 1, { maxBatchSize: 7 })

		expect(generated).toBe(true)
		expect(generateRegionAsync).toHaveBeenCalledTimes(1)
		expect(batches).toHaveLength(1)
		expect(batches[0]).toHaveLength(7)
		expect(game.objects.size).toBe(7)
		expect(game.getObject('tile:4,-1')).toBeDefined()
	})

	it('does not rematerialize already generated gameplay frontier tiles', async () => {
		const game = new Game({
			terrainSeed: 91,
			characterCount: 0,
		})
		games.add(game)
		await game.loaded

		const generateRegionAsync = vi
			.spyOn(game.generator, 'generateRegionAsync')
			.mockImplementation(async (_config, coords) =>
				[...coords].map((coord) => ({
					coord,
					terrain: 'grass' as const,
					height: 0,
					goods: {},
					walkTime: 3,
				}))
			)

		await game.requestGameplayFrontier({ q: 6, r: -2 }, 1, { maxBatchSize: 7 })
		expect(generateRegionAsync).toHaveBeenCalledTimes(1)

		await game.requestGameplayFrontier({ q: 6, r: -2 }, 1, { maxBatchSize: 7 })
		expect(generateRegionAsync).toHaveBeenCalledTimes(1)
	})

	it('exposes authoritative render terrain from materialized SSH tiles', async () => {
		const game = new Game({
			terrainSeed: 93,
			characterCount: 0,
		})
		games.add(game)
		await game.loaded

		expect(game.hasRenderableTerrainAt({ q: 20, r: 20 })).toBe(false)
		expect(game.getRenderableTerrainAt({ q: 20, r: 20 })).toBeUndefined()

		game.generate(
			{ terrainSeed: 93, characterCount: 0 },
			{ tiles: [{ coord: [1, 2], terrain: 'grass', height: 0.2 }] }
		)

		const tile = game.hex.getTile({ q: 1, r: 2 })
		const content = game.hex.getTileContent({ q: 1, r: 2 })
		expect(tile).toBeDefined()
		expect(content).toBeDefined()
		if (!tile) throw new Error('Expected tile to be materialized')
		if (!content?.tile) throw new Error('Expected content-backed tile to be materialized')

		expect(game.getRenderableTerrainAt({ q: 1, r: 2 })).toEqual(
			expect.objectContaining({
				terrain: 'grass',
				height: 0.2,
			})
		)

		content.tile.terrainState = { terrain: 'rocky', height: 0.9 }
		expect(game.hasRenderableTerrainAt({ q: 1, r: 2 })).toBe(true)
		expect(game.getRenderableTerrainAt({ q: 1, r: 2 })).toEqual(
			expect.objectContaining({
				terrain: 'rocky',
				height: 0.9,
			})
		)
	})

	it('keeps enforcing the batch cap across queued frontier requests', async () => {
		const game = new Game({
			terrainSeed: 92,
			characterCount: 0,
		})
		games.add(game)
		await game.loaded

		let releaseFirstBatch: (() => void) | undefined
		const firstBatchGate = new Promise<void>((resolve) => {
			releaseFirstBatch = resolve
		})
		const batchSizes: number[] = []
		const generateRegionAsync = vi
			.spyOn(game.generator, 'generateRegionAsync')
			.mockImplementation(async (_config, coords) => {
				const entries = [...coords]
				batchSizes.push(entries.length)
				if (batchSizes.length === 1) {
					await firstBatchGate
				}
				return entries.map((coord) => ({
					coord,
					terrain: 'grass' as const,
					height: 0,
					goods: {},
					walkTime: 3,
				}))
			})

		const first = game.requestGameplayFrontier({ q: 12, r: 0 }, 2, { maxBatchSize: 3 })
		const second = game.requestGameplayFrontier({ q: 16, r: 0 }, 2, { maxBatchSize: 3 })
		await Promise.resolve()
		expect(generateRegionAsync).toHaveBeenCalledTimes(1)
		expect(batchSizes).toEqual([3])

		releaseFirstBatch?.()
		await Promise.all([first, second])

		expect(batchSizes.every((size) => size <= 3)).toBe(true)
		expect(generateRegionAsync.mock.calls.length).toBeGreaterThan(1)
	})

	it('does not spawn equilibrium loose goods during streamed frontier materialization', async () => {
		const game = new Game({
			terrainSeed: 94,
			characterCount: 0,
		})
		games.add(game)
		await game.loaded

		const addLooseGood = vi.spyOn(game.hex.looseGoods, 'add')
		addLooseGood.mockClear()

		const generateRegionAsync = vi
			.spyOn(game.generator, 'generateRegionAsync')
			.mockImplementation(async (_config, coords) =>
				[...coords].map((coord) => ({
					coord,
					terrain: 'grass' as const,
					height: 0,
					goods: { wood: 4, mushroom: 2 },
					walkTime: 3,
				}))
			)

		const generated = await game.requestGameplayFrontier({ q: 8, r: -3 }, 1, { maxBatchSize: 7 })

		expect(generated).toBe(true)
		expect(generateRegionAsync).toHaveBeenCalledTimes(1)
		expect(addLooseGood).not.toHaveBeenCalled()
		expect(game.hasRenderableTerrainAt({ q: 8, r: -3 })).toBe(true)
	})

	it('publishes reset removals as one batched objectsRemoved event', async () => {
		const game = new Game({
			terrainSeed: 95,
			characterCount: 0,
		})
		games.add(game)
		await game.loaded

		game.hex.getTile({ q: 0, r: 0 })
		game.hex.getTile({ q: 1, r: 0 })
		game.hex.getTile({ q: 0, r: 1 })
		expect(game.objects.size).toBe(3)

		const removedBatches: string[][] = []
		game.on({
			objectsRemoved: (objects) => {
				removedBatches.push(objects.map((object) => object.uid).sort())
			},
		})

		game.hex.reset()

		expect(removedBatches).toHaveLength(1)
		expect(removedBatches[0]).toEqual(['tile:0,0', 'tile:0,1', 'tile:1,0'])
		expect(game.objects.size).toBe(0)
	})
})
