import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Game } from 'ssh/src/lib/game/game'
import { Character } from 'ssh/src/lib/population/character'
import { InventoryFunctions } from 'ssh/src/lib/npcs/context/inventory'
import { subject } from 'ssh/src/lib/npcs/scripts'
import type { Tile } from 'ssh/src/lib/board/tile'

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
    const terrainProxy = new Proxy({}, {
        get: (target, prop) => defaultTerrain
    })
    return {
        vehicles: {
            'by-hands': {
                storage: { slots: 10, capacity: 100 }
            }
        },
        goods: {
            wood: {}, 
            stone: {}, 
            food: { feedingValue: 1 }
        },
        terrain: terrainProxy,
        deposits: {},
        alveoli: {},
        configurations: {
            'specific-storage': { working: true, buffers: {} },
            default: { working: true }
        }
    }
})

describe('Work Logic / Inventory Race Conditions', () => {
    let game: Game
    let char: Character
    let inventoryFunctions: InventoryFunctions

    beforeEach(async () => {
        const config = { boardSize: 12, terrainSeed: 123, characterCount: 0 }
        game = new Game(config) 
        
        // Ensure generation (if constructor's async chain hasn't finished)
        // Pass config explicitly to avoid undefined error
        try { await game.generate(config) } catch(e) { console.warn('Generate skipped', e) }
        
        // Spawn character
        char = new Character(game, 'char1', 'Worker', { q: 0, r: 0 })
        // Accessing private characters map via any cast for test setup
        ;(game.population as any).characters.set(char.uid, char)
        
        // Initialize InventoryContext bound to character
        inventoryFunctions = new InventoryFunctions()
        Object.assign(inventoryFunctions, { [subject]: char })
    })

    it('should throw when planning grab for missing good (Specific Good)', () => {
        const targetPos = { q: 0, r: 1 }
        expect(() => inventoryFunctions.planGrabFree('wood', targetPos)).toThrow('No wood to grab')
    })


    it('should return idle plan when planning grab for missing good (Generic Grab)', () => {
        const targetPos = { q: 0, r: 1 }
        const plan = inventoryFunctions.planGrabFree(null, targetPos)
        expect(plan.type).toBe('idle')
    })

    it('should return idle plan when inventory is full (Generic Grab)', () => {
        const targetPos = { q: 0, r: 1 }
        const tile = game.hex.getTile(targetPos) as Tile
        game.hex.freeGoods.add(tile, 'wood', { position: targetPos })
        char.vehicle.storage.addGood('stone', 2000)
        
        expect(char.vehicle.storage.hasRoom('wood')).toBe(0)

        const plan = inventoryFunctions.planGrabFree(null, targetPos)
        expect(plan.type).toBe('idle')
    })
})
