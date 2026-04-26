import type { Tile } from 'ssh/board/tile'
import { Game } from 'ssh/game/game'
import { InventoryFunctions } from 'ssh/npcs/context/inventory'
import { subject } from 'ssh/npcs/scripts'
import { Character } from 'ssh/population/character'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock Game.prototype.getTexture before imports
// We still need to patch Game definition because it's not a global, it's a class from valid import.
// However, since we import Game from ./game, checking if we can patch prototype after import but before tests?
// Yes, patching prototype affects all instances.
// The issue before was 'document is not defined'.

// We can import now as document is mocked in setup.
// import { Game } from './game'
// Patch getTexture for this test file specifically or moved to setup?
// Let's keep it here for now as it seemed specific to rendering skipping.

// Mock dependencies
// ... rest of mocks
vi.mock('ssh/assets/game-content', () => {
	const defaultTerrain = { walkTime: 1, generation: { deposits: {} } }
	const terrainProxy = new Proxy(
		{},
		{
			get: (_target, _prop) => defaultTerrain,
		}
	)
	return {
		vehicles: {
			wheelbarrow: {
				storage: { slots: 10, capacity: 100 },
				walkTime: 1,
				transferTime: 1,
			},
		},
		goods: {
			wood: {},
			stone: {},
			food: { satiationStrength: 0.5 },
		},
		terrain: terrainProxy,
		deposits: {},
		alveoli: {},
		jobBalance: {
			offload: {
				projectTile: 30,
				alveolusBlocked: 25,
				residentialTile: 21,
				unloadToTile: 8,
				park: 17,
			},
			convey: 3,
			gather: 2.5,
			harvest: { clearing: 2.5, fallbackBase: 0.25, needsBonus: 0.5 },
			transform: 1,
			engineer: { foundation: 3, construct: 2 },
			defragment: 0.9,
		},
		configurations: {
			'specific-storage': { working: true, buffers: {} },
			default: { working: true },
		},
	}
})

describe('Work Logic / Inventory Race Conditions', () => {
	let game: Game
	let char: Character
	let inventoryFunctions: InventoryFunctions

	beforeEach(async () => {
		const config = { terrainSeed: 123, characterCount: 0 }
		game = new Game(config)

		// Ensure generation (if constructor's async chain hasn't finished)
		// Pass config explicitly to avoid undefined error
		try {
			await game.generate(config)
		} catch (e) {
			console.warn('Generate skipped', e)
		}

		// Spawn character
		char = new Character(game, 'char1', 'Worker', { q: 0, r: 0 })
		// Accessing private characters map via any cast for test setup
		;(game.population as any).characters.set(char.uid, char)

		// Initialize InventoryContext bound to character
		inventoryFunctions = new InventoryFunctions()
		Object.assign(inventoryFunctions, { [subject]: char })
	})

	afterEach(() => {
		game.destroy()
	})

	it('returns idle when planning grab for missing specific loose good', () => {
		const targetPos = { q: 0, r: 1 }
		const plan = inventoryFunctions.planGrabLoose('wood', targetPos)
		expect(plan.type).toBe('idle')
	})

	it('should return idle plan when planning grab for missing good (Generic Grab)', () => {
		const targetPos = { q: 0, r: 1 }
		for (const good of game.hex.looseGoods.getGoodsAt(targetPos)) {
			good.remove()
		}
		const plan = inventoryFunctions.planGrabLoose(null, targetPos)
		expect(plan.type).toBe('idle')
	})

	it('should return idle plan when there is no active transport (walking)', () => {
		const targetPos = { q: 0, r: 1 }
		const tile = game.hex.getTile(targetPos) as Tile
		game.hex.looseGoods.add(tile, 'wood', { position: targetPos })

		expect(char.carry).toBeUndefined()

		const plan = inventoryFunctions.planGrabLoose(null, targetPos)
		expect(plan.type).toBe('idle')
	})
})
