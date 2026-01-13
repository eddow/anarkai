
import { describe, it, expect } from 'vitest'
import { Game } from '$lib/game/game'
import { chopSaw } from '$lib/game/exampleGames'

describe('Source Allocation Stability', () => {
    
    it('ChopSaw scenario runs without Source Allocation errors', { timeout: 60000 }, async () => {
        const game = new Game({ 
            boardSize: 12, 
            terrainSeed: 1, 
            characterCount: 5,
            characterRadius: 5
        }, chopSaw)
        
        await game.loaded

        // Scripts are loaded by default in Game population via scriptsContext
        for (const char of game.population) {
            void char.scriptsContext
        }

        // Add lots of free goods to increase chance of concurrent interactions
        const hex = game.hex
        for (let i = 0; i < 100; i++) {
            const tile = hex.getTile({ 
                q: Math.floor(game.random() * 10) - 5, 
                r: Math.floor(game.random() * 10) - 5 
            })
            if (tile) hex.freeGoods.add(tile, 'wood', { position: tile.position })
        }

        let errorFound = false
        const originalError = console.error
        console.error = (...args: any[]) => {
            const msg = args.join(' ')
            if (msg.includes('Source allocation missing')) {
                errorFound = true
            }
            // Still log but avoid circularity by not passing the full mg object
            const safeArgs = args.map(a => (typeof a === 'object' && a !== null) ? '[Object]' : a)
            originalError(...safeArgs)
        }

        try {
            // Simulation
            const dt = 0.1
            for (let i = 0; i < 6000; i++) { // 10 minutes
                game.ticker.update(dt * 1000)
                if (errorFound) break
            }
        } finally {
            console.error = originalError
        }

        expect(errorFound).toBe(false)
    })
})
