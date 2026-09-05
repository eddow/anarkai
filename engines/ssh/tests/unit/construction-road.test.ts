import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { isConstructionSiteShell } from 'ssh/build-site'
import {
	buildRoadSegment,
	RoadConstructionSite,
	roadBuildRecipe,
	roadRefundGoods,
} from 'ssh/construction-road'
import { Game } from 'ssh/game/game'
import { describe, expect, it } from 'vitest'

const twoTileGame = () =>
	new Game(
		{ terrainSeed: 3, characterCount: 0, settlementGeneration: false },
		{
			terrains: {
				grass: [
					[0, 0],
					[0, 1],
				],
			},
		}
	)

describe('road construction helpers', () => {
	it('exposes a per-type build recipe', () => {
		expect(roadBuildRecipe('path').goods).toEqual({ stone: 1 })
		expect(roadBuildRecipe('asphalt').goods).toEqual({ stone: 2, planks: 1 })
		expect(roadBuildRecipe('path').time).toBeGreaterThan(0)
	})

	it('builds a segment on the board', async () => {
		const game = twoTileGame()
		await game.loaded
		game.ticker.stop()
		try {
			buildRoadSegment(game, [0, 0.5], 'path')
			expect(game.hex.getRoadType({ q: 0, r: 0.5 })).toBe('path')
		} finally {
			game.destroy()
		}
	})

	it('refunds road materials probabilistically', () => {
		expect(roadRefundGoods('path', () => 0)).toEqual({ stone: 1 })
		expect(roadRefundGoods('path', () => 0.999)).toEqual({})
		expect(roadRefundGoods('asphalt', () => 0)).toEqual({ stone: 2, planks: 1 })
	})

	it('advertises demand as a construction site and finalizes into a road', async () => {
		const game = twoTileGame()
		await game.loaded
		game.ticker.stop()
		try {
			const tile = game.hex.getTile({ q: 0, r: 0 })!
			const { project } = game.projects.createDraft('Roads', [])
			// Border (0,0)-(0,1): midpoint (0, 0.5), anchor (0,0).
			const site = new RoadConstructionSite(tile, [0, 0.5], 'path', project)
			game.hex.setTileContent(tile, site)

			expect(isConstructionSiteShell(site)).toBe(true)
			// Not ready until goods are delivered to the site's storage.
			expect(site.isReady).toBe(false)
			expect(site.remainingNeeds).toEqual({ stone: 1 })

			site.storage.addGood('stone', 1)
			expect(site.isReady).toBe(true)

			site.finalize()
			expect(game.hex.getRoadType({ q: 0, r: 0.5 })).toBe('path')
			// Tile is restored to UnBuiltLand after the segment is placed.
			expect(tile.content instanceof UnBuiltLand).toBe(true)
		} finally {
			game.destroy()
		}
	})
})
