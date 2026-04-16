import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import {
	type FreightLineDefinition,
	findGatherRouteSegments,
	normalizeFreightLineDefinition,
} from 'ssh/freight/freight-line'
import {
	computeLineFurtherGoods,
	listGoodsAllowedOnGatherSegment,
	listTilesInAxialRadius,
	measureHiveStoredGoodsSource,
	measureZoneLooseGoodsSource,
	measureZoneStandaloneConstructionNeedSink,
	projectLoadedGoodsAgainstFurtherNeeds,
} from 'ssh/freight/freight-stop-utility'
import { migrateV1FiltersToGoodsSelection } from 'ssh/freight/goods-selection-policy'
import type { SaveState } from 'ssh/game'
import type { GamePatches } from 'ssh/game/game'
import { Game } from 'ssh/game/game'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { toAxialCoord } from 'ssh/utils/position'
import { describe, expect, it } from 'vitest'
import { gatherFreightLine } from '../freight-fixtures'
import { TestEngine } from '../test-engine'

const woodOnly = migrateV1FiltersToGoodsSelection(['wood'])

function freightBayAnchor(hiveName: string, coord: readonly [number, number]) {
	return {
		kind: 'alveolus' as const,
		hiveName,
		alveolusType: 'freight_bay' as const,
		coord,
	}
}

describe('freight-stop-utility', () => {
	it('listGoodsAllowedOnGatherSegment respects loadSelection', () => {
		const line = normalizeFreightLineDefinition(
			gatherFreightLine({
				id: 'u:line',
				name: 'L',
				hiveName: 'H',
				coord: [0, 0],
				filters: ['wood'],
				radius: 2,
			})
		)
		const seg = findGatherRouteSegments(line)[0]!
		const allowed = listGoodsAllowedOnGatherSegment(line, seg)
		expect(allowed).toEqual(['wood'])
	})

	it('listTilesInAxialRadius includes center and neighbors within radius', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
				{ coord: [5, 5] as const, terrain: 'grass' as const },
			],
		} satisfies GamePatches
		const game = new Game({ terrainSeed: 12001, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()
		try {
			const tiles = listTilesInAxialRadius(game, { q: 0, r: 0 }, 1)
			const keys = new Set(
				tiles
					.map((t) => toAxialCoord(t.position))
					.flatMap((coord) => (coord ? [`${coord.q},${coord.r}`] : []))
			)
			expect(keys.has('0,0')).toBe(true)
			expect(keys.has('1,0')).toBe(true)
			expect(keys.has('5,5')).toBe(false)
		} finally {
			game.destroy()
		}
	})

	it('measureZoneLooseGoodsSource counts available loose goods in radius', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [2, 0] as const, terrain: 'grass' as const },
			],
			looseGoods: [{ goodType: 'wood' as const, position: { q: 2, r: 0 } }],
		} satisfies GamePatches
		const game = new Game({ terrainSeed: 12002, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()
		try {
			const snap = measureZoneLooseGoodsSource(game, { q: 0, r: 0 }, 3, new Set(['wood'] as const))
			expect(snap.perGood.wood).toBe(1)
			expect(snap.total).toBe(1)
		} finally {
			game.destroy()
		}
	})

	it('measureZoneStandaloneConstructionNeedSink sums remainingNeeds in radius', async () => {
		const patches = {
			tiles: [{ coord: [1, 0] as const, terrain: 'grass' as const }],
		} satisfies GamePatches
		const game = new Game({ terrainSeed: 12003, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()
		try {
			const tile = game.hex.getTile({ q: 1, r: 0 })!
			tile.content = new BuildDwelling(tile, 'basic_dwelling')
			const site = tile.content as BuildDwelling
			expect(site.remainingNeeds.wood ?? 0).toBeGreaterThan(0)

			const snap = measureZoneStandaloneConstructionNeedSink(
				game,
				{ q: 0, r: 0 },
				2,
				new Set(['wood', 'berries', 'planks'] as const)
			)
			expect(snap.perGood.wood).toBe(site.remainingNeeds.wood)
			expect(snap.perGood.planks).toBe(site.remainingNeeds.planks)
			expect(snap.total).toBe((snap.perGood.wood ?? 0) + (snap.perGood.planks ?? 0))
		} finally {
			game.destroy()
		}
	})

	it('measureHiveStoredGoodsSource sums stock across hive logistics storages', async () => {
		const engine = new TestEngine({ terrainSeed: 12004, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{ name: 'S', alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: { wood: 3 } }] },
				],
			}
			engine.loadScenario(scenario)
			const gather = engine.game.hex.getTile({ q: 0, r: 0 })?.content as StorageAlveolus | undefined
			expect(gather).toBeDefined()
			const hive = gather!.hive
			const snap = measureHiveStoredGoodsSource(hive, new Set(['wood', 'berries'] as const))
			expect(snap.perGood.wood).toBe(3)
			expect(snap.perGood.berries).toBeUndefined()
			expect(snap.total).toBe(3)
		} finally {
			await engine.destroy()
		}
	})

	it('computeLineFurtherGoods accumulates later unload needs across multiple segments', async () => {
		const engine = new TestEngine({ terrainSeed: 12005, characterCount: 0 })
		await engine.init()
		try {
			const line: FreightLineDefinition = normalizeFreightLineDefinition({
				id: 'u:future-need',
				name: 'Future need',
				stops: [
					{ id: 'load-a', loadSelection: woodOnly, anchor: freightBayAnchor('A', [0, 0]) },
					{ id: 'need-a', zone: { kind: 'radius', center: [1, 0], radius: 1 } },
					{ id: 'load-b', loadSelection: woodOnly, anchor: freightBayAnchor('B', [2, 0]) },
					{ id: 'need-b', zone: { kind: 'radius', center: [3, 0], radius: 1 } },
				],
			})
			engine.loadScenario({
				hives: [
					{ name: 'A', alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }] },
					{ name: 'B', alveoli: [{ coord: [2, 0], alveolus: 'freight_bay', goods: {} }] },
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)
			const siteATile = engine.game.hex.getTile({ q: 1, r: 0 })!
			siteATile.content = new BuildDwelling(siteATile, 'basic_dwelling')
			const siteA = siteATile.content as BuildDwelling
			const siteBTile = engine.game.hex.getTile({ q: 3, r: 0 })!
			siteBTile.content = new BuildDwelling(siteBTile, 'basic_dwelling')
			const siteB = siteBTile.content as BuildDwelling

			const further = computeLineFurtherGoods({
				game: engine.game,
				line,
				currentStopIndex: 0,
			})

			expect(further.furtherNeededGoods.perGood.wood).toBe(
				(siteA.remainingNeeds.wood ?? 0) + (siteB.remainingNeeds.wood ?? 0)
			)
			expect(further.furtherProvidedGoods.perGood.wood).toBeUndefined()
			expect(further.furtherTransferredGoods.perGood.wood).toBeUndefined()
		} finally {
			await engine.destroy()
		}
	})

	it('computeLineFurtherGoods nets later provided goods only against later unloads', async () => {
		const engine = new TestEngine({ terrainSeed: 12006, characterCount: 0 })
		await engine.init()
		try {
			const line: FreightLineDefinition = normalizeFreightLineDefinition({
				id: 'u:future-netting',
				name: 'Future netting',
				stops: [
					{ id: 'current-load', loadSelection: woodOnly, anchor: freightBayAnchor('A', [0, 0]) },
					{ id: 'future-load', loadSelection: woodOnly, anchor: freightBayAnchor('B', [2, 0]) },
					{ id: 'future-need', zone: { kind: 'radius', center: [4, 0], radius: 1 } },
				],
			})
			engine.loadScenario({
				hives: [
					{ name: 'A', alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }] },
					{ name: 'B', alveoli: [{ coord: [2, 0], alveolus: 'freight_bay', goods: { wood: 2 } }] },
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)
			const needTile = engine.game.hex.getTile({ q: 4, r: 0 })!
			needTile.content = new BuildDwelling(needTile, 'basic_dwelling')
			const site = needTile.content as BuildDwelling
			const siteNeed = site.remainingNeeds.wood ?? 0

			const further = computeLineFurtherGoods({
				game: engine.game,
				line,
				currentStopIndex: 0,
			})

			expect(further.furtherTransferredGoods.perGood.wood).toBe(Math.min(2, siteNeed))
			if (siteNeed > 2) expect(further.furtherNeededGoods.perGood.wood).toBe(siteNeed - 2)
			else expect(further.furtherNeededGoods.perGood.wood).toBeUndefined()
			expect(further.furtherProvidedGoods.perGood.wood).toBeUndefined()
		} finally {
			await engine.destroy()
		}
	})

	it('projectLoadedGoodsAgainstFurtherNeeds separates retained cargo, remaining need, and surplus', () => {
		const projected = projectLoadedGoodsAgainstFurtherNeeds({ wood: 2, berries: 4 }, { wood: 5 })
		expect(projected.reservedLoadedGoods.perGood.wood).toBe(2)
		expect(projected.remainingNeededGoods.perGood.wood).toBe(3)
		expect(projected.surplusLoadedGoods.perGood.berries).toBe(4)
		expect(projected.surplusLoadedGoods.perGood.wood).toBeUndefined()
	})
})
