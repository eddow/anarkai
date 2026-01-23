
import { describe, it, expect, vi } from 'vitest'
import { Game } from 'ssh/src/lib/game'
import { InventoryFunctions } from 'ssh/src/lib/npcs/context/inventory'

// Mock environment
if (typeof document === 'undefined') {
    ;(global as any).document = {
        createElement: () => ({
            getContext: () => ({
                getParameter: () => 0,
                getExtension: () => ({}),
            }),
            addEventListener: () => {},
        }),
    }
    ;(global as any).document.baseURI = 'http://localhost/'
}
if (typeof window === 'undefined') (global as any).window = global
if (typeof location === 'undefined') (global as any).location = { href: 'http://localhost/', protocol: 'http:', host: 'localhost', hostname: 'localhost' }
if (typeof navigator === 'undefined') (global as any).navigator = { userAgent: 'node' }
if (typeof requestAnimationFrame === 'undefined') (global as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 16)

// Mock assets/resources
vi.mock('ssh/assets/resources', () => ({ resources: {}, prefix: '' }))
vi.mock('ssh/assets/game-content', () => ({
    vehicles: { 'by-hands': { storage: { slots: 10, capacity: 100 } } },
    goods: { wood: {}, stone: {}, food: { feedingValue: 1 } },
    terrain: new Proxy({}, { get: () => ({ walkTime: 1, generation: { deposits: {} } }) }),
    deposits: { tree: { generation: { frequency: 0.1 }, maxAmount: 100 } },
    alveoli: { 'tree_chopper': { action: { deposit: 'tree' } } },
    configurations: {
        'specific-storage': { working: true, buffers: {} },
        default: { working: true }
    }
}))

describe('Offload Silent Cancellation Reproduction', () => {
    // Scripts and context are now handled via static imports and default char.scriptsContext

    it('Reproduction: Offload work cancels silently', async () => {
        const game = new Game({ boardSize: 12, terrainSeed: 1234, characterCount: 0 })
        await game.loaded
        
        const char = game.population.createCharacter('Worker', { q: 2, r: 2 })
        
        // Setup target tile for offloading
        const targetTile = game.hex.getTile({ q: 3, r: 2 })
        if (!targetTile) throw new Error('Target tile not found')
        
        // Add free goods to the target tile
        // We need to mock availableGoods on the tile or ensure freeGoods system works
        // Tile doesn't have availableGoods by default? It's likely a getter using game.hex.freeGoods
        // Let's check if we can add to freeGoods directly
        game.hex.freeGoods.add(targetTile, 'wood', { position: targetTile.position })
        
        // Verify goods are there
        const goodsAtTile = game.hex.freeGoods.getGoodsAt(targetTile.position)
        expect(goodsAtTile.length).toBeGreaterThan(0)
        expect(goodsAtTile[0].goodType).toBe('wood')

        // Use default scriptsContext which has all scripts loaded
        const context = char.scriptsContext as any;
        
        // Ensure scripts are loaded (it's a getter that triggers loading)
        void context; 

        // Mock find.path to return a valid path and avoid test environment crash
        context.find.path = vi.fn().mockImplementation((dest) => [dest])
        
        const work = (context as any).work
        if (!work.offload) throw new Error('offload not loaded') 
        
        // Construct Plan
        const plan = {
            type: 'work',
            job: 'offload',
            target: targetTile,
            urgency: 1,
            fatigue: 0,
            invariant: () => true
        }

        // Execute Offload
        const execution = work.offload(plan)
        
        // We want to capture logs if possible, but standard console.log is fine
        // Watch for 'work: begun', 'idle: begun' via console listener or spy?
        const logs: string[] = []
        const originalLog = console.log
        console.log = (...args) => {
            logs.push(args.join(' '))
            originalLog(...args)
        }
        
        try {
            let result = execution.run(context)
            let loops = 0
            while (result && result.type === 'yield' && loops < 50) {
                char.update(0.1) 
                
                // Tick yielded step if applicable
                const step = result.value
                if (step && typeof step.tick === 'function') {
                    // For test purposes, we can just finish it immediately or tick it
                    // Let's tick it
                    let ticks = 0
                    while (step.status === 'pending' && ticks < 100) {
                        step.tick(0.1)
                        ticks++
                    }
                }

                result = execution.run(context)
                loops++
            }
            
            console.log('Final Logs:', logs)
            
            // Check if char picked up the wood AND dropped it (offload complete)
            expect(char.carry.stock.wood ?? 0).toBe(0)
            
        } catch (e) {
            console.log('Final Logs:', logs)
            console.log('InventoryFunctions prototype keys:', Object.keys(InventoryFunctions.prototype))
            console.log('InventoryFunctions prototype names:', Object.getOwnPropertyNames(InventoryFunctions.prototype))
            const scriptInstance = (context as any).inventory
            console.log('Context inventory keys:', Object.keys(JSON.parse(JSON.stringify(scriptInstance || {})))) 
            // scriptInstance is protoCtx, might not be JSON serializable nicely
            console.log('Context inventory prop names:', Object.getOwnPropertyNames(scriptInstance || {}))
            throw e
        } finally {
            console.log = originalLog
        }
    })
})
