import { Deposit, UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { Game } from 'ssh/game/game'
import { alveolusClass } from 'ssh/hive'
import { WorkFunctions } from 'ssh/npcs/context/work'
import { subject } from 'ssh/npcs/scripts'
import type { GameRenderer } from 'ssh/types/engine'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function headlessRenderer(
	invalidateTerrain: (coord?: { q: number; r: number }) => void
): GameRenderer {
	return {
		initialize: async () => {},
		destroy: () => {},
		resize: () => {},
		getTexture: () => ({}) as never,
		reload: async () => {},
		invalidateTerrain,
	}
}

describe('notifyTerrainDepositsChanged / sector resource refresh hooks', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	describe('Game.notifyTerrainDepositsChanged', () => {
		beforeEach(async () => {
			game = new Game(
				{ terrainSeed: 7, characterCount: 0 },
				{ tiles: [{ coord: [0, 0], terrain: 'forest' }] }
			)
			await game.loaded
			game.ticker.stop()
		})

		it('calls renderer.invalidateTerrain with tile axial coord', () => {
			const invalidateTerrain = vi.fn()
			game.renderer = headlessRenderer(invalidateTerrain)
			const tile = game.hex.getTile({ q: 0, r: 0 })!
			game.notifyTerrainDepositsChanged(tile)
			expect(invalidateTerrain).toHaveBeenCalledTimes(1)
			expect(invalidateTerrain.mock.calls[0][0]).toMatchObject({ q: 0, r: 0 })
		})
	})

	describe('deposit tile patches', () => {
		it('calls invalidateTerrain when applying deposit patch during load', async () => {
			const invalidateTerrain = vi.fn()
			game = new Game(
				{ terrainSeed: 11, characterCount: 0 },
				{
					tiles: [{ coord: [2, -1], terrain: 'forest', deposit: { type: 'tree', amount: 4 } }],
				}
			)
			game.renderer = headlessRenderer(invalidateTerrain)
			await game.loaded
			game.ticker.stop()
			expect(invalidateTerrain).toHaveBeenCalled()
			expect(invalidateTerrain).toHaveBeenCalledWith(expect.objectContaining({ q: 2, r: -1 }))
			const content = game.hex.getTileContent({ q: 2, r: -1 })
			expect(content).toBeInstanceOf(UnBuiltLand)
			if (content instanceof UnBuiltLand) {
				expect(content.deposit?.amount).toBe(4)
			}
		})
	})

	describe('UnBuiltLand.setProject', () => {
		beforeEach(async () => {
			game = new Game(
				{ terrainSeed: 17, characterCount: 0 },
				{
					tiles: [{ coord: [0, 0], terrain: 'forest' }],
				}
			)
			await game.loaded
			game.ticker.stop()
		})

		it('patches project tiles to concrete and invalidates terrain', () => {
			const invalidateTerrain = vi.fn()
			game.renderer = headlessRenderer(invalidateTerrain)
			const tile = game.hex.getTile({ q: 0, r: 0 })!
			const content = tile.content
			expect(content).toBeInstanceOf(UnBuiltLand)
			if (!(content instanceof UnBuiltLand)) return

			content.setProject('build:sawmill')

			expect(content.project).toBe('build:sawmill')
			expect(content.terrain).toBe('concrete')
			expect(tile.baseTerrain).toBe('concrete')
			expect(tile.terrainState?.terrain).toBe('concrete')
			expect(invalidateTerrain).toHaveBeenCalledWith(expect.objectContaining({ q: 0, r: 0 }))
		})
	})

	describe('WorkFunctions.harvestStep', () => {
		beforeEach(async () => {
			game = new Game(
				{ terrainSeed: 13, characterCount: 0 },
				{
					tiles: [
						{ coord: [0, 0], terrain: 'forest' },
						{ coord: [1, 0], terrain: 'concrete' },
					],
				}
			)
			await game.loaded
			game.ticker.stop()
		})

		it('calls notifyTerrainDepositsChanged after reducing deposit', () => {
			const notifySpy = vi.spyOn(game, 'notifyTerrainDepositsChanged')
			const tileForest = game.hex.getTile({ q: 0, r: 0 })!
			const TreeDeposit = Deposit.class.tree
			if (!TreeDeposit) throw new Error('Deposit.class.tree missing')
			game.hex.setTileContent(tileForest, new UnBuiltLand(tileForest, 'forest', new TreeDeposit(2)))

			const tileWork = game.hex.getTile({ q: 1, r: 0 })!
			const ChopCtor = alveolusClass.tree_chopper
			if (!ChopCtor) throw new Error('alveolusClass.tree_chopper missing')
			const chopper = new ChopCtor(tileWork)
			game.hex.setTileContent(tileWork, chopper)

			const char = game.population.createCharacter('Worker', { q: 0, r: 0 })
			char.assignedAlveolus = chopper

			const wf = new WorkFunctions()
			Object.assign(wf, { [subject]: char })
			wf.harvestStep()

			expect(notifySpy).toHaveBeenCalledTimes(1)
			expect(notifySpy).toHaveBeenCalledWith(char.tile)
			const land = char.tile.content
			expect(land).toBeInstanceOf(UnBuiltLand)
			if (land instanceof UnBuiltLand) {
				expect(land.deposit?.amount).toBe(1)
			}
		})
	})
})
