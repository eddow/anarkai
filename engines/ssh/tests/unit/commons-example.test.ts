import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { listHives } from 'ssh/commerce/board-sources'
import { Shop } from 'ssh/commerce/shop'
import { findDistributeRouteSegments, findGatherRouteSegments } from 'ssh/freight/freight-line'
import { commons } from 'ssh/game/exampleGames'
import { Game } from 'ssh/game/game'
import { TransformAlveolus } from 'ssh/hive/transform'
import { afterEach, describe, expect, it } from 'vitest'

describe('commons example game', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('boots the commerce starting point: 4 unitary hives, empty zones, routes, no start burden', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, commons)
		await game.loaded
		game.ticker.stop()

		// ── Four separate unitary hives (they did not merge). ────────────────
		const hives = listHives(game)
		expect(hives.map((hive) => hive.name).sort()).toEqual(['Depot', 'Grove', 'Mill', 'Quarry'])
		const byName = new Map(hives.map((hive) => [hive.name, hive]))
		expect(byName.get('Grove')!.alveoli.size).toBe(3) // bay + chopper + forester (no output pile)
		expect(byName.get('Mill')!.alveoli.size).toBe(5) // bay + 2 sawmills + wood + plank piles
		expect(byName.get('Quarry')!.alveoli.size).toBe(2) // bay + stonecutter (no output pile)
		expect(byName.get('Depot')!.alveoli.size).toBe(5) // bay + 2 storages + 2 engineers

		// Every hive has its own freight bay — the estate delivery tile.
		for (const hive of hives) {
			expect([...hive.alveoli].some((alv) => alv.action?.type === 'road-fret')).toBe(true)
		}

		// ── The two Mill sawmills both resolve the shared named config. ─────
		const sawmillA = game.hex.getTile({ q: 5, r: -1 })?.content
		const sawmillB = game.hex.getTile({ q: 4, r: -2 })?.content
		expect(sawmillA).toBeInstanceOf(TransformAlveolus)
		expect(sawmillB).toBeInstanceOf(TransformAlveolus)
		expect(
			(sawmillA as TransformAlveolus).transformConfiguration.productRatio?.maxProductRatio
		).toBe(0.55)
		expect(
			(sawmillB as TransformAlveolus).transformConfiguration.productRatio?.maxProductRatio
		).toBe(0.55)

		// ── Zones exist and are EMPTY: no pre-built dwellings/shops, and no
		//    generated deposits or loose goods on the (concrete) zone tiles. ──
		expect(game.hex.getTile({ q: -3, r: 3 })?.zone?.type).toBe('commercial')
		expect(game.hex.getTile({ q: 2, r: 3 })?.zone?.type).toBe('residential')
		expect(game.hex.zoneManager.findZoneByName('grove-wood')).toBeDefined()

		const zoneTiles = [...game.hex.tiles].filter(
			(tile) => tile.zone?.type === 'residential' || tile.zone?.type === 'commercial'
		)
		expect(zoneTiles.length).toBeGreaterThan(0)
		for (const tile of zoneTiles) {
			const content = tile.content
			expect(content instanceof BasicDwelling || content instanceof BuildDwelling).toBe(false)
			expect(content instanceof Shop).toBe(false)
			// concrete zones have no generated deposit or loose goods at gamestart.
			expect((content as { deposit?: unknown }).deposit).toBeUndefined()
			expect(game.hex.looseGoods.getGoodsAt(tile.position).length).toBe(0)
		}

		// The board-wide deficit ledger starts empty (no forward-declared demand).
		expect(game.netDeficitLedger).toEqual({})

		// ── Routes, vehicles, settlement. ───────────────────────────────────
		const lineNames = [...game.freightLines].map((line) => line.name)
		expect(lineNames).toEqual(
			expect.arrayContaining(['Grove gather', 'Mill wood run', 'Commerce loop'])
		)
		// The "Grove gather" radius zone MUST stay centered on its bay anchor, else the
		// engine reclassifies it as a bay→zone *distribute* route and the gather leg
		// (load wood in the forest → unload at the bay) never runs.
		const gather = [...game.freightLines].find((line) => line.name === 'Grove gather')!
		expect(findGatherRouteSegments(gather)).toHaveLength(1)
		expect(findDistributeRouteSegments(gather)).toHaveLength(0)
		expect([...game.vehicles]).toHaveLength(6) // 3 assigned + 3 free (one-shot pool)
		// Seed 549 deterministically places Melindbury at the same spot as chopSaw.
		expect(game.getSettlementTradeProfileAtCenter({ q: 7, r: 19 })?.name).toBe('Melindbury')

		// ── The forest remains the sole resource area. ──────────────────────
		const forestTile = game.hex.getTile({ q: 2, r: -4 })
		expect(forestTile?.zone?.type).toBe('harvest')
	}, 20000)
})
