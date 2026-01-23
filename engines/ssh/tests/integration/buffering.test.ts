
import { describe, it, expect } from 'vitest'
import { Game } from 'ssh/src/lib/game'
import { StorageAlveolus } from 'ssh/src/lib/hive/storage'
import { SpecificStorage } from 'ssh/src/lib/storage'

describe('Buffering Logic', () => {

    it('transfers goods from full non-buffering storage to empty buffering storage', { timeout: 60000 }, async () => {
        const game = new Game({
            boardSize: 12,
            terrainSeed: 1,
            characterCount: 1, 
            characterRadius: 5
        }, {
            hives: [
                {
                    name: 'TestHive',
                    alveoli: [
                        {
                            coord: [0, 0],
                            alveolus: 'woodpile', // Should map to StorageAlveolus now
                            goods: { wood: 72 }
                        },
                        {
                            coord: [1, 0],
                            alveolus: 'woodpile',
                            goods: {}
                        }
                    ]
                }
            ]
        })

        // Stop ticker to control time manually
        game.ticker.stop()
        await game.loaded
        
        // Setup done via patches. Now configure buffers.
        const tileA = game.hex.getTile({ q: 0, r: 0 })!
        const tileB = game.hex.getTile({ q: 1, r: 0 })!
        
        const woodpileA = tileA.content as StorageAlveolus
        const woodpileB = tileB.content as StorageAlveolus
        
        expect(woodpileA).toBeInstanceOf(StorageAlveolus)
        expect(woodpileB).toBeInstanceOf(StorageAlveolus)
        expect(woodpileA.storage).toBeInstanceOf(SpecificStorage)
        
        expect(woodpileA.storage.stock.wood).toBe(72)
        expect(woodpileB.storage.stock.wood).toBeUndefined()
        
        // Configure Buffer on B: demand 72 wood (Full buffer)
        woodpileB.storageBuffers = { 'wood': 72 }
        
        // Initialize scripts context for population
        for (const char of game.population) {
            void char.scriptsContext
        }

        // Simulation Loop
        const dt = 0.1
        let woodMoved = false
        
        // Run for enough time
        for (let i = 0; i < 6000; i++) { 
            game.ticker.update(dt * 1000)
            
            // Check if transfer happened
            if ((woodpileB.storage.stock.wood || 0) > 0) {
                woodMoved = true
                
                // If we moved some wood, success basically.
                // We want to see if A decreased.
                if ((woodpileA.storage.stock.wood || 0) < 72) {
                     break 
                }
            }
        }
        
        expect(woodMoved).toBe(true)
        expect(woodpileB.storage.stock.wood).toBeGreaterThan(0)
        expect(woodpileA.storage.stock.wood).toBeLessThan(72)
    })
})
