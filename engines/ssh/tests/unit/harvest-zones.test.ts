import { Deposit, UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { Game } from 'ssh/game'
import type { HarvestAlveolus } from 'ssh/hive/harvest'
import { toAxialCoord } from 'ssh/utils/position'
import { describe, expect, it, vi } from 'vitest'
import { TestEngine } from '../test-engine/engine'

// Mock DOM/Pixi environment for Node
if (typeof document === 'undefined') {
	;(global as any).document = {
		createElement: () => ({
			getContext: () => ({ getParameter: () => 0, getExtension: () => ({}) }),
			addEventListener: () => {},
		}),
	}
	;(global as any).document.baseURI = 'http://localhost/'
}
if (typeof window === 'undefined') {
	;(global as any).window = global
}

vi.mock('ssh/assets/resources', () => ({ resources: {}, prefix: '' }))
vi.mock('ssh/assets/game-content', () => ({
	vehicles: { 'by-hands': { storage: { slots: 10, capacity: 100 } } },
	goods: { wood: {} },
	terrain: new Proxy({}, { get: () => ({ walkTime: 1, generation: { deposits: {} } }) }),
	deposits: { tree: { generation: { frequency: 0.1 }, maxAmount: 100 } },
	alveoli: {
		tree_chopper: {
			action: { type: 'harvest', deposit: 'tree', output: { wood: 1 } },
		},
	},
	configurations: {
		'specific-storage': { working: true, buffers: {} },
		default: { working: true },
	},
}))

describe('Harvest Zones Restriction', () => {
	it('find.deposit should ignore deposits outside of zones/clearing', async () => {
		const game = new Game({
			boardSize: 2,
			terrainSeed: 123,
			characterCount: 0,
		})
		await game.loaded

		// Ensure all tiles have content to avoid walkNeighbors error
		for (let q = -game.hex.boardSize; q <= game.hex.boardSize; q++) {
			for (let r = -game.hex.boardSize; r <= game.hex.boardSize; r++) {
				const coord = { q, r }
				const tile = game.hex.getTile(coord)
				if (tile && !tile.content) {
					tile.content = new UnBuiltLand(tile, 'grass')
				}
			}
		}

		const char = game.population.createCharacter('Worker', { q: 0, r: 0 })
		const find = char.scriptsContext.find

		// 1. Place a tree at (1,0) with NO zone
		const farTile = game.hex.getTile({ q: 1, r: 0 })!
		farTile.content = new UnBuiltLand(farTile, 'grass', new Deposit(100))
		// Manually set name because Deposit.class mock might not set it
		Object.defineProperty(farTile.content.deposit, 'name', { value: 'tree' })
		farTile.zone = undefined

		// Verify find.deposit returns false even though a tree exists
		expect(find.deposit('tree')).toBe(false)

		// 2. Set (1,0) as harvest zone
		farTile.zone = 'harvest'
		const pathInZone = find.deposit('tree')
		expect(pathInZone).not.toBe(false)
		expect(toAxialCoord(pathInZone[pathInZone.length - 1])).toMatchObject({
			q: 1,
			r: 0,
		})

		// 3. Remove zone but make it a residential zone (which is "clearing")
		farTile.zone = 'residential'
		const pathInClearing = find.deposit('tree')
		expect(pathInClearing).not.toBe(false)
		expect(toAxialCoord(pathInClearing[pathInClearing.length - 1])).toMatchObject({ q: 1, r: 0 })
	})

	it('harvest alveolus nextJob returns undefined instead of throwing when action is missing at runtime', async () => {
		const engine = new TestEngine({
			boardSize: 2,
			terrainSeed: 123,
			characterCount: 0,
		})
		await engine.init()
		const { game } = engine

		engine.loadScenario({
			tiles: [
				{
					coord: [1, 0] as [number, number],
					deposit: { type: 'tree', name: 'tree', amount: 10 },
					terrain: 'forest',
				},
			],
			hives: [
				{
					name: 'LumberJack',
					alveoli: [{ coord: [0, 0] as [number, number], alveolus: 'tree_chopper' }],
				},
			],
			zones: {
				harvest: [[1, 0] as [number, number]],
			},
		} as any)

		const harvestTile = game.hex.getTile({ q: 0, r: 0 })
		const alveolus = harvestTile?.content as HarvestAlveolus | undefined
		expect(alveolus).toBeDefined()

		Object.defineProperty(alveolus!, 'action', {
			value: undefined,
			writable: true,
			configurable: true,
		})

		expect(() => alveolus!.nextJob()).not.toThrow()
		expect(alveolus!.nextJob()).toBeUndefined()
	})
})
