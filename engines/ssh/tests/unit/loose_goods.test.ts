import { Commitment } from 'ssh/commitment'
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

		expect(good.isRemoved).toBe(false)
		expect(game.hex.looseGoods.getGoodsAt(tile.position)).toContain(good)

		good.remove()

		expect(good.isRemoved).toBe(true)
		expect(game.hex.looseGoods.getGoodsAt(tile.position)).not.toContain(good)

		good.remove()

		expect(game.hex.looseGoods.getGoodsAt(tile.position)).toHaveLength(0)
	})

	it('removes a moving good by stored ownership even after its position changes', () => {
		const startTile = game.hex.getTile({ q: 0, r: 0 }) as Tile
		const moving = game.hex.looseGoods.add(startTile, 'wood', {
			position: startTile.position,
		})

		moving.position = { q: 1, r: 0 }
		moving.remove()

		expect(moving.isRemoved).toBe(true)
		expect(game.hex.looseGoods.getGoodsAt({ q: 0, r: 0 })).not.toContain(moving)
		expect(game.hex.looseGoods.getGoodsAt({ q: 1, r: 0 })).not.toContain(moving)
	})

	it('decays only eligible loose goods during grouped updates', () => {
		const tile = game.hex.getTile({ q: 0, r: 0 }) as Tile
		const woodA = game.hex.looseGoods.add(tile, 'wood', { position: tile.position })
		const woodB = game.hex.looseGoods.add(tile, 'wood', { position: tile.position })
		const mushrooms = game.hex.looseGoods.add(tile, 'mushrooms', { position: tile.position })
		const stone = game.hex.looseGoods.add(tile, 'stone', { position: tile.position })

		;(game as any).random = vi.fn(() => 0.5)

		game.hex.looseGoods.applyDecay(1e9)

		const remainingGoods = game.hex.looseGoods.getGoodsAt(tile.position)

		expect(woodA.isRemoved).toBe(true)
		expect(woodB.isRemoved).toBe(true)
		expect(mushrooms.isRemoved).toBe(true)
		expect(stone.isRemoved).toBe(false)
		expect(remainingGoods).toEqual([stone])
	})

	describe('claims', () => {
		it('prevents a second claim on the same good', () => {
			const tile = game.hex.getTile({ q: 0, r: 0 }) as Tile
			const good = game.hex.looseGoods.add(tile, 'wood', { position: tile.position })
			const first = new Commitment('test.claim.first')
			const second = new Commitment('test.claim.second')

			expect(good.allocate(first)).toBeUndefined()
			expect(good.claimedBy).toBe(first)
			expect(good.available).toBe(false)

			expect(good.allocate(second)).toBe('LooseGood already allocated')
			expect(good.claimedBy).toBe(first)

			first.cancel('test-cleanup')
			second.cancel('test-cleanup')
		})

		it('frees the good when its claim is cancelled', () => {
			const tile = game.hex.getTile({ q: 0, r: 0 }) as Tile
			const good = game.hex.looseGoods.add(tile, 'wood', { position: tile.position })
			const claim = new Commitment('test.claim.cancel')

			good.allocate(claim)
			claim.cancel('test.cancel')

			expect(good.claimedBy).toBeUndefined()
			expect(good.available).toBe(true)
			expect(good.isRemoved).toBe(false)
		})

		it('removes the good when its claim is fulfilled', () => {
			const tile = game.hex.getTile({ q: 0, r: 0 }) as Tile
			const good = game.hex.looseGoods.add(tile, 'wood', { position: tile.position })
			const claim = new Commitment('test.claim.fulfill')

			good.allocate(claim)
			claim.fulfill()

			expect(good.isRemoved).toBe(true)
			expect(game.hex.looseGoods.getGoodsAt(tile.position)).toHaveLength(0)
		})

		it('cancels an outstanding claim when the good decays', () => {
			const tile = game.hex.getTile({ q: 0, r: 0 }) as Tile
			const good = game.hex.looseGoods.add(tile, 'wood', { position: tile.position })
			const claim = new Commitment('test.claim.decay')

			good.allocate(claim)
			;(game as any).random = vi.fn(() => 0.5)

			game.hex.looseGoods.applyDecay(1e9)

			expect(good.isRemoved).toBe(true)
			expect(claim.ended).toBe('loose-decayed')
		})
	})
})
