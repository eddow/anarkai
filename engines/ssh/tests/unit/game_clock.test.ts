
import { describe, it, expect, beforeEach } from 'vitest'
import { Game } from '$lib/game/game'
import { configuration } from '$lib/globals'

describe('Game Clock', () => {
    let game: Game

    beforeEach(async () => {
        game = new Game({
            boardSize: 12,
            terrainSeed: 1,
            characterCount: 1,
            characterRadius: 5
        })
        game.ticker.stop()
        await game.loaded
        // Reset time to 0 manually if needed or just instantiate new game
        game.clock.virtualTime = 0
    })

    it('increments time correctly based on time controls', () => {
        // Default to play
        configuration.timeControl = 'play'
        
        // Tick 1 second of real time in 100ms chunks (10 steps)
        for(let i=0; i<10; i++) {
             game.ticker.update(100)
        }
        
        // rootSpeed = 2, multiplier = 1 -> delta = 2s total
        expect(game.clock.virtualTime).toBeCloseTo(2, 0.1)

        // Switch to fast-forward
        configuration.timeControl = 'fast-forward'
        // multiplier = 2 -> delta should be 2 * 2 = 4s
        for(let i=0; i<10; i++) {
             game.ticker.update(100)
        }

        expect(game.clock.virtualTime).toBeCloseTo(2 + 4, 0.1) // 6

        // Switch to pause
        configuration.timeControl = 'pause'
        // multiplier = 0 -> delta should be 0
        for(let i=0; i<10; i++) {
             game.ticker.update(100)
        }

        expect(game.clock.virtualTime).toBeCloseTo(6, 0.1)
    })
})
