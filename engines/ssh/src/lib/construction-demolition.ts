import { construction } from 'engine-rules'
import { Alveolus } from 'ssh/board/content/alveolus'
import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import type { TileContent } from 'ssh/board/content/content'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { Tile } from 'ssh/board/tile'
import { isConstructionSiteShell } from 'ssh/build-site'
import { resolveAlveolusVariant } from 'ssh/construction-state'
import { traces } from 'ssh/dev/debug'
import type { AlveolusType, GoodType } from 'ssh/types/base'
import { axial, tileSize } from 'ssh/utils'
import { toAxialCoord, toWorldCoord } from 'ssh/utils/position'

/**
 * Full construction material cost of a structure (all ancestor-chain hops plus
 * foundation). Used to compute the demolition refund.
 */
function contentConstructionGoods(content: TileContent): Partial<Record<GoodType, number>> {
	const goods: Partial<Record<GoodType, number>> = {}
	const add = (recipe: { goods?: object } | undefined) => {
		for (const [good, qty] of Object.entries(recipe?.goods ?? {})) {
			const n = typeof qty === 'number' ? qty : 0
			if (n > 0) goods[good as GoodType] = (goods[good as GoodType] ?? 0) + n
		}
	}

	if (content instanceof Alveolus) {
		const resolved = resolveAlveolusVariant(content.name as AlveolusType, content.variant)
		for (const recipe of resolved?.ancestorChain ?? []) add(recipe)
		add(construction.foundation)
		return goods
	}

	if (content instanceof BasicDwelling) {
		add(construction.dwellings.basic_dwelling)
		add(construction.foundation)
		return goods
	}

	if (isConstructionSiteShell(content)) {
		// A partially-built shell refunds only what has already been consumed.
		const site = content.constructionSite
		for (const [good, qty] of Object.entries(site.consumedGoods ?? {})) {
			const n = typeof qty === 'number' ? qty : 0
			if (n > 0) goods[good as GoodType] = (goods[good as GoodType] ?? 0) + n
		}
		for (const [good, qty] of Object.entries(site.foundationConsumedGoods ?? {})) {
			const n = typeof qty === 'number' ? qty : 0
			if (n > 0) goods[good as GoodType] = (goods[good as GoodType] ?? 0) + n
		}
		return goods
	}

	return goods
}

/** Drop one loose good per unit at a random position within the tile. */
function spawnLooseGoods(tile: Tile, goods: Partial<Record<GoodType, number>>): void {
	const { x: tileX, y: tileY } = toWorldCoord(tile.position)!
	for (const [goodType, quantity] of Object.entries(goods)) {
		const n = quantity ?? 0
		for (let i = 0; i < n; i++) {
			const { x, y } = axial.randomPositionInTile(tile.board.game.random, tileSize)
			tile.board.looseGoods.add(tile.position, goodType as GoodType, {
				position: { x: tileX + x, y: tileY + y },
			})
		}
	}
}

/** Dump all goods currently stored in a structure's storage onto the tile as loose goods. */
function dumpStorageToLooseGoods(
	tile: Tile,
	storage: {
		stock: { [k in GoodType]?: number }
		removeGood(goodType: GoodType, qty: number): number
	}
): void {
	for (const [goodType, quantity] of Object.entries(storage.stock)) {
		const n = quantity ?? 0
		if (n <= 0) continue
		spawnLooseGoods(tile, { [goodType as GoodType]: n })
		storage.removeGood(goodType as GoodType, n)
	}
}

/**
 * Refund a random ~50% of a structure's construction materials as loose goods.
 * Each unit is independently refunded with probability {@link construction.demolition.refundFraction}.
 */
export function demolitionRefundGoods(
	content: TileContent,
	random: () => number
): Partial<Record<GoodType, number>> {
	const full = contentConstructionGoods(content)
	const refund: Partial<Record<GoodType, number>> = {}
	for (const [good, qty] of Object.entries(full)) {
		let amount = 0
		for (let i = 0; i < (qty ?? 0); i++) {
			if (random() < construction.demolition.refundFraction) amount++
		}
		if (amount > 0) refund[good as GoodType] = amount
	}
	return refund
}

/**
 * Demolish whatever structure currently sits on `tile` (alveolus, dwelling, or a
 * mid-construction shell): refund ~50% of construction materials + any stored goods
 * as loose goods on the tile, then replace the content with fresh `UnBuiltLand`.
 *
 * Alveoli go through `cleanUp` (dump storage) + `deconstruct` (remove from hive,
 * clear gates, restore the tile) + `destroy` (clear assigned worker).
 */
export function demolishStructure(tile: Tile): void {
	const content = tile.content
	if (!content || content instanceof UnBuiltLand) return

	const coord = toAxialCoord(tile.position)
	traces.work({ tile }).log?.('work.demolish', {
		contentType: content.constructor?.name,
		tileQ: coord?.q,
		tileR: coord?.r,
	})

	// Refund construction materials first, then any goods still stored inside.
	spawnLooseGoods(
		tile,
		demolitionRefundGoods(content, () => tile.board.game.random())
	)

	const terrain = tile.terrainState?.terrain ?? tile.baseTerrain ?? 'grass'
	if (content instanceof Alveolus) {
		content.cleanUp()
		content.deconstruct()
		content.destroy()
	} else {
		if (content.storage) dumpStorageToLooseGoods(tile, content.storage)
		if ('destroy' in content && typeof (content as { destroy?: unknown }).destroy === 'function') {
			;(content as { destroy(): void }).destroy()
		}
		tile.content = new UnBuiltLand(tile, terrain)
	}
	tile.board.game.invalidateWorkPlanning('demolition.structure')
	tile.board.game.enqueueInteractiveChange(tile)
}

/** Remove one road segment (a single border midpoint) from the board. */
export function demolishRoadSegment(
	game: { hex: { setRoadType(ref: { q: number; r: number }, type?: unknown): void } },
	coord: readonly [number, number]
): void {
	game.hex.setRoadType({ q: coord[0], r: coord[1] }, undefined)
}
