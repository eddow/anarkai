import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { queryConstructionSiteView } from 'ssh/construction'
import { createConstructionSiteState, foundationGoodsComplete } from 'ssh/construction-state'
import { DEFAULT_DISTRICT_ID, districtUid } from 'ssh/district/district'
import { Game } from 'ssh/game/game'
import { afterEach, describe, expect, it } from 'vitest'

describe('district and concrete construction', () => {
	const games = new Set<Game>()

	afterEach(() => {
		for (const game of games) game.destroy()
		games.clear()
	})

	async function gameAtOrigin() {
		const game = new Game({
			terrainSeed: 12,
			characterCount: 0,
			settlementGeneration: false,
		})
		games.add(game)
		await game.loaded
		await game.ensureGameplaySectors(['0,0'])
		const tile = game.hex.getTile({ q: 0, r: 0 })
		expect(tile).toBeDefined()
		if (!tile) throw new Error('Expected origin tile')
		return { game, tile }
	}

	it('creates a default district and resolves it as a game object', async () => {
		const { game } = await gameAtOrigin()

		expect(game.listDistricts().map((district) => district.id)).toContain(DEFAULT_DISTRICT_ID)
		expect(game.getObject(districtUid(DEFAULT_DISTRICT_ID))?.title).toBe('Default district')
	})

	it('records district members for district-scoped build and zone actions', async () => {
		const { game, tile } = await gameAtOrigin()

		expect(game.applyDistrictZoneAction(tile, 'residential')).toBe(true)
		expect(game.getDistrict()?.memberCount).toBe(1)
	})

	it('creates and saves the shared player account', async () => {
		const { game } = await gameAtOrigin()

		expect(game.playerAccount.balanceVp).toBeGreaterThan(0)
		expect(game.spendVp(5)).toBe(true)
		expect(game.saveGameData().playerAccount?.balanceVp).toBe(game.playerAccount.balanceVp)
		game.creditVp(3)
		expect(game.playerAccount.balanceVp).toBe(game.saveGameData().playerAccount!.balanceVp)
	})

	it('requires concrete before foundation goods are complete', () => {
		const state = createConstructionSiteState({ kind: 'dwelling', tier: 'basic_dwelling' })

		expect(state.foundationRequiredGoods).toEqual({ concrete: 1 })
		expect(foundationGoodsComplete(state)).toBe(false)
		state.foundationDeliveredGoods = { concrete: 1 }
		expect(foundationGoodsComplete(state)).toBe(true)
	})

	it('shows missing concrete on a new project site', async () => {
		const { game, tile } = await gameAtOrigin()
		const content = tile.content
		expect(content).toBeInstanceOf(UnBuiltLand)
		if (!(content instanceof UnBuiltLand)) throw new Error('Expected unbuilt land')

		content.setProject('build:storage')
		const view = queryConstructionSiteView(game, tile)

		expect(view?.phase).toBe('waiting_materials')
		expect(view?.requiredGoods).toEqual({ concrete: 1 })
		expect(view?.blockingReasons).toContain('missing_goods')
	})
})
