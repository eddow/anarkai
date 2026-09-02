import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { listHives } from 'ssh/commerce/board-sources'
import { Shop } from 'ssh/commerce/shop'
import { findDistributeRouteSegments, findGatherRouteSegments } from 'ssh/freight/freight-line'
import { soviet } from 'ssh/game/exampleGames'
import { Game } from 'ssh/game/game'
import { TransformAlveolus } from 'ssh/hive/transform'
import { afterEach, describe, expect, it } from 'vitest'

describe('soviet example game', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('boots two production hive designs as working plans, two W+S pairs, marker zones, and routes', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, soviet)
		await game.loaded
		game.ticker.stop()

		// ── Two registered templates (designs). ────────────────────────────
		expect(game.hivePlans.plans.map((plan) => plan.name).sort()).toEqual(['Stone', 'Wood'])
		for (const plan of game.hivePlans.plans) {
			expect(plan.entries.length).toBeGreaterThan(0)
		}

		// ── Four placed hives (two W+S pairs, none merged). ────────────────
		const hives = listHives(game)
		expect(hives.map((hive) => hive.name).sort()).toEqual(['Stone', 'Stone II', 'Wood', 'Wood II'])
		const byName = new Map(hives.map((hive) => [hive.name, hive]))
		// Wood/Wood II: bay + chopper + forester + sawmill + wood pile + plank pile + storage + build engineer
		expect(byName.get('Wood')!.alveoli.size).toBe(8)
		expect(byName.get('Wood II')!.alveoli.size).toBe(8)
		// Stone/Stone II: bay + stonecutter + stone pile + storage + road engineer
		expect(byName.get('Stone')!.alveoli.size).toBe(5)
		expect(byName.get('Stone II')!.alveoli.size).toBe(5)

		// Every hive has its own freight bay — the estate delivery tile.
		for (const hive of hives) {
			expect([...hive.alveoli].some((alv) => alv.action?.type === 'road-fret')).toBe(true)
		}

		// ── Both sawmills resolve the shared named config. ─────────────────
		for (const coord of [
			{ q: -6, r: -2 },
			{ q: -27, r: -2 },
		]) {
			const sawmill = game.hex.getTile(coord)?.content
			expect(sawmill).toBeInstanceOf(TransformAlveolus)
			expect(
				(sawmill as TransformAlveolus).transformConfiguration.productRatio?.maxProductRatio
			).toBe(0.55)
		}

		// ── Marker zones: residential/commercial 3×3 empty, harvest markers. ──
		expect(game.hex.getTile({ q: -8, r: 2 })?.zone?.type).toBe('residential')
		expect(game.hex.getTile({ q: -11, r: 2 })?.zone?.type).toBe('commercial')
		expect(game.hex.zoneManager.findZoneByName('woodland')).toBeDefined()

		const zoneTiles = [...game.hex.tiles].filter(
			(tile) => tile.zone?.type === 'residential' || tile.zone?.type === 'commercial'
		)
		expect(zoneTiles).toHaveLength(18) // 9 residential + 9 commercial
		for (const tile of zoneTiles) {
			expect(tile.content instanceof BasicDwelling || tile.content instanceof BuildDwelling).toBe(
				false
			)
			expect(tile.content instanceof Shop).toBe(false)
		}

		// ── Terrain modification sits under the hives only. ────────────────
		// The hive patch lays the concrete footing…
		expect(game.hex.getTile({ q: -9, r: -2 })?.baseTerrain).toBe('concrete')
		expect(game.hex.getTile({ q: -18, r: 6 })?.baseTerrain).toBe('concrete')
		expect(game.hex.getTile({ q: -30, r: -2 })?.baseTerrain).toBe('concrete')
		expect(game.hex.getTile({ q: -30, r: 2 })?.baseTerrain).toBe('concrete')
		// …while the settlement zones are NOT foundationed: they keep seed terrain
		// (concrete is never seed-generated, only patched).
		expect(game.hex.getTile({ q: -8, r: 2 })?.baseTerrain).not.toBe('concrete')
		expect(game.hex.getTile({ q: -11, r: 2 })?.baseTerrain).not.toBe('concrete')

		// ── Routes, vehicles, settlement. ───────────────────────────────────
		const lineNames = [...game.freightLines].map((line) => line.name)
		expect(lineNames).toEqual(
			expect.arrayContaining([
				'Wood gather',
				'Stone deliver',
				'Commerce loop',
				'Wood II gather',
				'Stone II deliver',
				'Commerce loop II',
			])
		)
		// The "Wood gather" radius zone is centered on its bay anchor, so it is a
		// *gather* route, not a bay→zone distribute route.
		const gather = [...game.freightLines].find((line) => line.name === 'Wood gather')!
		expect(findGatherRouteSegments(gather)).toHaveLength(1)
		expect(findDistributeRouteSegments(gather)).toHaveLength(0)
		expect([...game.vehicles]).toHaveLength(9) // 6 assigned (3/pair) + 3 free (one-shot pool)
		// The duplicated pair ships its own gather / exchange / commerce routes.
		const gatherII = [...game.freightLines].find((line) => line.name === 'Wood II gather')!
		expect(findGatherRouteSegments(gatherII)).toHaveLength(1)
		expect(findDistributeRouteSegments(gatherII)).toHaveLength(0)

		// ── Workers staffing the duplicated pair. ──────────────────────────
		const characters = [...game.population]
		expect(characters.map((c) => c.name).sort()).toEqual([
			'Stone II cutter',
			'Stone II roadworker',
			'Wood II builder',
			'Wood II chopper',
			'Wood II forester',
			'Wood II sawyer',
		])
		// Every placed worker is staffed (not wandering) — the exact building is
		// planner-dependent once the sim ticks (e.g. a sawyer conveys planks while
		// the sawmill still awaits wood).
		for (const character of characters) {
			expect(character.assignedAlveolus).toBeDefined()
		}

		// Seed 549 deterministically places the nearest settlement (Vickenvulmere)
		// that the Commerce loop trades planks→concrete with.
		expect(game.getSettlementTradeProfileAtCenter({ q: -4, r: -17 })?.name).toBe('Vickenvulmere')
	}, 20000)
})
