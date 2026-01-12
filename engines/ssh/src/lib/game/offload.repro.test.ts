
import { describe, it, expect, vi, beforeAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

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
vi.mock('$assets/resources', () => ({ resources: {}, prefix: '' }))
vi.mock('$assets/game-content', () => ({
    vehicles: { 'by-hands': { storage: { slots: 10, capacity: 100 } } },
    goods: { wood: {}, stone: {}, food: { feedingValue: 1 } },
    terrain: new Proxy({}, { get: () => ({ walkTime: 1, generation: { deposits: {} } }) }),
    deposits: { tree: { generation: { frequency: 0.1 }, maxAmount: 100 } },
    alveoli: { 'tree_chopper': { action: { deposit: 'tree' } } }
}))

describe('Offload Silent Cancellation Reproduction', () => {
    let Game: any
    let workScript: string
    let inventoryScript: string
    let InteractiveContext: any
    let loadNpcScripts: any
    let subject: any
    let protoCtx: any
    let WorkFunctions: any
    let InventoryFunctions: any
    let WalkFunctions: any
    let FindFunctions: any
    let PlanFunctions: any

    beforeAll(async () => {
        const gameModule = await import('./game')
        Game = gameModule.Game
        
        // Read the actual work.npcs script
        // Correct path relative to this file: ../../../assets/scripts/work.npcs (since we are in src/lib/game)
        const __dirname = path.dirname(fileURLToPath(import.meta.url))
        workScript = fs.readFileSync(path.resolve(__dirname, '../../../assets/scripts/work.npcs'), 'utf-8')
        inventoryScript = fs.readFileSync(path.resolve(__dirname, '../../../assets/scripts/inventory.npcs'), 'utf-8')

        const scriptsModule = await import('./npcs/scripts')
        InteractiveContext = scriptsModule.InteractiveContext
        loadNpcScripts = scriptsModule.loadNpcScripts
        subject = scriptsModule.subject
        protoCtx = scriptsModule.protoCtx

        WorkFunctions = (await import('./npcs/context/work')).WorkFunctions
        InventoryFunctions = (await import('./npcs/context/inventory')).InventoryFunctions
        WalkFunctions = (await import('./npcs/context/walk')).WalkFunctions
        FindFunctions = (await import('./npcs/context/find')).FindFunctions
        PlanFunctions = (await import('./npcs/context/plan')).PlanFunctions
    })

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

        // Create Context
        const context = new InteractiveContext()
        ;(context as any)[subject] = char
        const bind = (Class: any, name: string) => {
            const instance = protoCtx(Class)
            instance[subject] = char
            ;(context as any)[name] = instance
        }
        
        bind(WorkFunctions, 'work')
        bind(InventoryFunctions, 'inventory')
        bind(WalkFunctions, 'walk')
        bind(FindFunctions, 'find')
        bind(PlanFunctions, 'plan')
        ;(context as any).I = char

        // Mock find.path to return a valid path and avoid test environment crash
        ;(context as any).find.path = vi.fn().mockImplementation((dest) => [dest])

        // Load scripts
        loadNpcScripts({ 
            '/scripts/work.npcs': workScript,
            '/scripts/inventory.npcs': inventoryScript
        }, context)
        
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
