import { describe, it, expect } from 'vitest'
import { Game } from '$lib/game/game'
import { chopSaw } from '$lib/game/exampleGames'
import { Character } from '$lib/game/population/character'

describe('Eating Requirement', () => {
    it('carriedFood only returns food if at least 1 unit is available', async () => {
        const game = new Game({
            boardSize: 12,
            terrainSeed: 1,
            characterCount: 0, // No random characters
            characterRadius: 5
        }, chopSaw)
        
        await game.loaded
        
        const char = new Character(game, 'test-char', 'Tester', { x: 0, y: 0 })
        
        // initially no food
        expect(char.carriedFood).toBeUndefined()
        
        // Add 0.5 food
        // Note: we inject directly into carry.slots or use addGood if possible.
        // SlottedStorage addGood adds to quantity.
        char.carry.addGood('berries', 0.5)
        
        // Should be undefined because 0.5 < 1
        // Currently (before fix) this will likely fail (return 'berries')
        expect(char.carriedFood).toBeUndefined()
        
        // Add another 0.5
        char.carry.addGood('berries', 0.5)
        
        // Now should have 1.0, so should be visible
        expect(char.carriedFood).toBe('berries')
    })
})
