import { generate as generateTerrain } from 'engine-terrain'
import { Game } from 'ssh/game/game'
import { BoardGenerator, GameGenerator, type GameGenerationConfig } from 'ssh/generation'
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

function findRiverInfluencedCoord(seed: number, boardSize: number) {
	const snapshot = generateTerrain(seed, boardSize)
	for (const [key, biome] of snapshot.biomes) {
		if (biome !== 'river-bank' && biome !== 'lake') continue
		const [q, r] = key.split(',').map(Number)
		return { q, r }
	}
	return undefined
}

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
		const coord = findRiverInfluencedCoord(config.terrainSeed, boardSize)
		expect(coord).toBeDefined()

		const snapshot = generateTerrain(config.terrainSeed, boardSize)
		const full = new BoardGenerator().generateBoard(snapshot)
		const streamed = generator.generateRegion(config, [coord!])

		const fullTile = full.find((tile) => tile.coord.q === coord!.q && tile.coord.r === coord!.r)
		expect(fullTile).toBeDefined()
		expect(streamed).toHaveLength(1)
		expect(streamed[0]!.terrain).toBe(fullTile!.terrain)
		expect(streamed[0]!.height).toBe(fullTile!.height)
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
})
