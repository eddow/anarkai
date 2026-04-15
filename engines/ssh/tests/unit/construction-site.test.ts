import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { queryConstructionSiteView } from 'ssh/construction'
import { chopSaw } from 'ssh/game/exampleGames'
import { Game } from 'ssh/game/game'
import { BuildAlveolus } from 'ssh/hive/build'
import { afterEach, describe, expect, it } from 'vitest'

describe('queryConstructionSiteView', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('returns planned with tile_not_clear when the project tile is blocked', async () => {
		game = new Game(
			{ terrainSeed: 21, characterCount: 0 },
			{
				tiles: [{ coord: [0, 0], terrain: 'forest', deposit: { type: 'tree', amount: 2 } }],
			}
		)
		await game.loaded
		game.ticker.stop()
		const tile = game.hex.getTile({ q: 0, r: 0 })!
		const land = tile.content
		expect(land).toBeInstanceOf(UnBuiltLand)
		if (!(land instanceof UnBuiltLand)) return
		land.setProject('build:sawmill')
		expect(land.constructionSite?.target.kind).toBe('alveolus')
		if (land.constructionSite?.target.kind === 'alveolus') {
			expect(land.constructionSite.target.alveolusType).toBe('sawmill')
		}
		const view = queryConstructionSiteView(game, tile)
		expect(view?.phase).toBe('planned')
		expect(view?.blockingReasons).toContain('tile_not_clear')
		expect(land.constructionSite?.phase).toBe('planned')
	})

	it('returns foundation without blocking when an engineer can reach a clear project tile', async () => {
		game = new Game({ terrainSeed: 99, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()
		const tile = game.hex.getTile({ q: 9, r: -7 })
		expect(tile).toBeTruthy()
		const land = tile?.content
		expect(land).toBeInstanceOf(UnBuiltLand)
		const phaseBeforeQuery = land instanceof UnBuiltLand ? land.constructionSite?.phase : undefined
		const view = queryConstructionSiteView(game, tile!)
		expect(view?.phase).toBe('foundation')
		expect(view?.blockingReasons.length).toBe(0)
		if (land instanceof UnBuiltLand) expect(land.constructionSite?.phase).toBe(phaseBeforeQuery)
	})

	it('returns waiting_materials for an incomplete BuildAlveolus', async () => {
		game = new Game(
			{ terrainSeed: 31, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0], terrain: 'concrete' },
					{ coord: [1, 0], terrain: 'concrete' },
				],
				hives: [
					{
						name: 'HiveSite',
						alveoli: [{ coord: [0, 0], alveolus: 'engineer' }],
					},
				],
			}
		)
		await game.loaded
		game.ticker.stop()
		const tile = game.hex.getTile({ q: 1, r: 0 })!
		const site = new BuildAlveolus(tile, 'storage')
		tile.content = site
		const view = queryConstructionSiteView(game, tile)
		expect(view?.phase).toBe('waiting_materials')
		expect(view?.blockingReasons).toContain('missing_goods')
		expect(site.constructionSite.phase).toBe('waiting_materials')
		expect(site.constructionSite.requiredGoods).toEqual(
			site.requiredGoods as Partial<Record<'wood' | 'planks' | 'stone', number>>
		)
	})

	it('does not mutate build-site phase when query reports waiting_construction from current facts', async () => {
		game = new Game(
			{ terrainSeed: 41, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0], terrain: 'concrete' },
					{ coord: [1, 0], terrain: 'concrete' },
				],
				hives: [
					{
						name: 'ReadyHive',
						alveoli: [{ coord: [0, 0], alveolus: 'engineer' }],
					},
				],
			}
		)
		await game.loaded
		game.ticker.stop()
		const tile = game.hex.getTile({ q: 1, r: 0 })!
		const site = new BuildAlveolus(tile, 'engineer')
		site.storage.addGood('wood', 1)
		site.storage.addGood('stone', 1)
		tile.content = site

		expect(site.constructionSite.phase).toBe('waiting_construction')
		const view = queryConstructionSiteView(game, tile)
		expect(view?.phase).toBe('waiting_construction')
		expect(site.constructionSite.phase).toBe('waiting_construction')
	})

	it('tolerates a transient build-site shell without storage during query', () => {
		const view = queryConstructionSiteView(
			{
				hex: {
					tiles: [],
				},
			} as Game,
			{
				content: {
					tile: {} as never,
					constructionSite: {
						phase: 'waiting_materials',
						target: { kind: 'alveolus', alveolusType: 'storage' },
						recipe: { workSeconds: 6 },
						requiredGoods: { wood: 1 },
						deliveredGoods: {},
						consumedGoods: {},
						workSecondsApplied: 0,
						blockingReasons: [],
					},
					storage: undefined,
					constructionWorkSecondsApplied: 0,
					working: true,
					destroyed: false,
					canTake: () => false,
					canGive: () => false,
					requiredGoods: { wood: 1 },
					remainingNeeds: { wood: 1 },
					advertisedNeeds: {},
					isReady: false,
					workingGoodsRelations: {},
				},
			} as never
		)

		expect(view?.phase).toBe('waiting_materials')
		expect(view?.blockingReasons).toContain('missing_goods')
		expect(view?.deliveredGoods).toEqual({})
	})
})
