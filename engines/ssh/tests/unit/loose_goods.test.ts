import type { Tile } from 'ssh/board/tile'
import { Game } from 'ssh/game/game'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('LooseGoods', () => {
	let game: Game

	beforeEach(async () => {
		game = new Game({
			terrainSeed: 1,
			characterCount: 0,
			characterRadius: 5,
		})
		game.ticker.stop()
		await game.loaded
	})

	afterEach(() => {
		game.destroy()
	})

	it('marks goods as removed in O(1) state and safely ignores double removal', () => {
		const tile = game.hex.getTile({ q: 0, r: 0 }) as Tile
		const good = game.hex.looseGoods.add(tile, 'wood', { position: tile.position })
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})

		expect(good.isRemoved).toBe(false)
		expect(game.hex.looseGoods.getGoodsAt(tile.position)).toContain(good)

		good.remove()

		expect(good.isRemoved).toBe(true)
		expect(game.hex.looseGoods.getGoodsAt(tile.position)).not.toContain(good)

		good.remove()

		expect(warn).toHaveBeenCalledTimes(1)
		expect(game.hex.looseGoods.getGoodsAt(tile.position)).toHaveLength(0)
		warn.mockRestore()
		error.mockRestore()
	})

	it('decays only eligible loose goods during grouped updates', () => {
		const tile = game.hex.getTile({ q: 0, r: 0 }) as Tile
		const woodA = game.hex.looseGoods.add(tile, 'wood', { position: tile.position })
		const woodB = game.hex.looseGoods.add(tile, 'wood', { position: tile.position })
		const mushrooms = game.hex.looseGoods.add(tile, 'mushrooms', { position: tile.position })
		const stone = game.hex.looseGoods.add(tile, 'stone', { position: tile.position })
		const allocatedWood = game.hex.looseGoods.add(tile, 'wood', {
			position: tile.position,
			available: false,
		})

		;(game as any).random = vi.fn(() => 0.5)

		game.hex.looseGoods.update(1e9)

		const remainingGoods = game.hex.looseGoods.getGoodsAt(tile.position)

		expect(woodA.isRemoved).toBe(true)
		expect(woodB.isRemoved).toBe(true)
		expect(mushrooms.isRemoved).toBe(true)
		expect(stone.isRemoved).toBe(false)
		expect(allocatedWood.isRemoved).toBe(false)
		expect(remainingGoods).toEqual(expect.arrayContaining([stone, allocatedWood]))
		expect(remainingGoods).toHaveLength(2)
	})
})
