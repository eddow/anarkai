// Manual DOM mock for PixiJS (copied from save_load_verify.test.ts)
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
if (typeof window === 'undefined') {
    ;(global as any).window = global
}
if (typeof location === 'undefined') {
    ;(global as any).location = { href: 'http://localhost/', protocol: 'http:', host: 'localhost', hostname: 'localhost' }
}
if (typeof navigator === 'undefined') {
	;(global as any).navigator = { userAgent: 'node' }
} else {
    try { ;(global as any).navigator = { userAgent: 'node' } } catch (e) {}
}
if (typeof requestAnimationFrame === 'undefined') {
    ;(global as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 16)
}
if (typeof localStorage === 'undefined') {
    ;(global as any).localStorage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
        clear: () => {}
    }
}
if (typeof Image === 'undefined') {
    ;(global as any).Image = class {
        _src = ''
        onload = () => {}
        onerror = () => {}
        set src(val: string) {
            this._src = val
            setTimeout(() => this.onload && this.onload(), 1)
        }
        get src() { return this._src }
    }
}
// Bypass asset loading
if (typeof fetch === 'undefined' || true) {
    ;(global as any).fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ frames: {}, meta: { size: { w: 1, h: 1 } } }),
        blob: async () => ({ type: 'image/png', arrayBuffer: async () => new ArrayBuffer(0) }),
        text: async () => '',
        headers: new Map(),
    })
}

import { describe, it, expect, vi } from 'vitest'
import { Game } from '$lib/game/game'
import { subject, protoCtx } from '$lib/game/npcs/scripts'
import { WorkFunctions } from '$lib/game/npcs/context/work'
import { InventoryFunctions } from '$lib/game/npcs/context/inventory'
import { WalkFunctions } from '$lib/game/npcs/context/walk'
import { FindFunctions } from '$lib/game/npcs/context/find'
import { PlanFunctions } from '$lib/game/npcs/context/plan'

// Mock assets/resources
vi.mock('$assets/resources', () => ({
    resources: {}, 
    prefix: ''
}))

vi.mock('$assets/game-content', () => {
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
        deposits: {
            tree: { 
                generation: { frequency: 0.1 },
                maxAmount: 100
            }
        },
        alveoli: {
            'tree_chopper': {
                action: { deposit: 'tree' }
            }
        },
        configurations: {
            'specific-storage': { working: true, buffers: {} },
            default: { working: true }
        }
    }
})

describe('Behavior Verification', () => {
    // Scripts and context are now handled via static imports and default char.scriptsContext

    it('Harvest Behavior: Runs and Persists (Savegame)', async () => {
        const game = new Game({ boardSize: 12, terrainSeed: 1234, characterCount: 0 })
        await game.loaded
        
        const char = game.population.createCharacter('Worker', { q: 2, r: 2 })
        
        // Mock alveolus target
        const targetTile = game.hex.getTile({ q: 3, r: 2 })
        if (!targetTile) throw new Error('Target tile not found')
        
        // Create Mock Alveolus
        const alveolus = {
            tile: targetTile,
            action: { 
                type: 'harvest',             // Required by harvestStep
                deposit: 'tree',
                output: { wood: 1 }          // Required by harvestStep
            },
            allows: () => true,
            nextJob: vi.fn()
                .mockReturnValueOnce({ job: 'harvest', urgency: 1, fatigue: 0, path: [] })
                .mockReturnValue(null),      // Return job once then stop
            workTime: 1,                     // Required by harvestStep duration
            name: 'CreateWood',
            // Mock storage for validation?
            hive: { name: 'Hive1' }
        }
        
        // Assign alveolus to character (critical step missing before)
        char.assignedAlveolus = alveolus as any

        // Setup a tree deposit at char's location so it doesn't have to walk
        const charTile = game.hex.getTile(char.position)
        if (charTile && charTile.content) {
             // Mock the deposit
             (charTile.content as any).deposit = {
                 name: 'tree',
                 amount: 100,
                 type: 'tree' // matches alveolus.action.deposit? No, action.deposit is 'tree', type is 'tree'
             }
             // Ensure it looks like UnBuiltLand
             if (!charTile.content.constructor) (charTile.content as any).constructor = { name: 'UnBuiltLand' }
             // Or just patch instance check if needed (WorkFunctions line 176 checks instanceof)
             // But import is static. 
             // WorkFunctions imports UnBuiltLand.
             // We might need to ensure charTile.content IS an instance of UnBuiltLand.
             // Game generation creates UnBuiltLand.
        }
        
        // Use default scriptsContext which has all scripts loaded
        const context = char.scriptsContext;
        void context; // Trigger loading
        
        // char.scriptsContext already has these bound, but if we want to ensure they are the ones we imported:
        // bind(WorkFunctions, 'work')
        // ...

        // Mock find.path to avoid complex pathfinding if needed, or let it run if it works.
        // For simple adjacent tiles, it might work.
        // But find.path(target, false) in script.
        // If we want to be safe, we can mock `find.path` specifically.
        // Let's spy/mock it on the instance.
        // (context as any).find.path = vi.fn().mockReturnValue([{ q: 3, r: 2 }]) // Simple path to target
        
        // Scripts are loaded by default via scriptsContext
        void context;
        
        const work = context.work
        if (!work) throw new Error('work namespace not loaded')
        if (!work.harvest) throw new Error('harvest not loaded') 
        // work.npcs returns { goWork, harvest, ... } so they should be on context.
        
        // Construct Plan
        const plan = {
            type: 'work',
            job: 'harvest',
            target: alveolus,
            urgency: 1,
            fatigue: 0,
            invariant: () => {
                // Invariant: If we have goods, we should have dropped them or be carrying them?
                // For now, just return true to test mechanism.
                return true
            }
        }

        // Execute Harvest
        const execution = work.harvest(plan)
        
        // Run execution steps
        // execution.run(context) returns result or yields.
        let result = execution.run(context)
        let loops = 0
        while (result && result.type === 'yield' && loops < 100) {
            // Simulate game loop updates if needed (e.g. walking)
            char.update(0.1)
            result = execution.run(context)
            loops++
        }
        
        if (loops >= 100) throw new Error('Harvest stuck in loop')
        
        // Check invariant execution
        // We assume 'finally' or 'conclude' was called which checked the invariant.
        // If it failed, it would throw.
         
        // Test Persistence / Savegame
        const saveState = game.saveGameData()
        
        // Reload
        const game2 = new Game({ boardSize: 12, terrainSeed: 1234, characterCount: 0 })
        await game2.loaded
        game2.loadGameData(saveState)
        
        // Provide character retrieval logic
        const char2 = game2.population.character(char.uid)
        expect(char2).toBeDefined()
    })

    it('Transform Behavior: Runs and Persists', async () => {
        const game = new Game({ boardSize: 12, terrainSeed: 555, characterCount: 0 })
        await game.loaded
        
        const char = game.population.createCharacter('Worker', { q: 2, r: 2 })
        
        // Mock alveolus
        const targetTile = game.hex.getTile({ q: 3, r: 2 })
        
        const storageMock = {
            reserve: vi.fn().mockReturnValue({ fulfill: vi.fn(), cancel: vi.fn() }),
            allocate: vi.fn().mockReturnValue({ fulfill: vi.fn(), cancel: vi.fn() }),
            fragmented: false // for defragment check
        }
        
        const alveolus = {
            tile: targetTile,
            action: { 
                type: 'transform',
                inputs: { wood: 1 },
                output: { charcoal: 1 }
            },
            allows: () => true,
            nextJob: vi.fn()
                .mockReturnValueOnce({ job: 'transform', urgency: 1, fatigue: 0, path: [] })
                .mockReturnValue(null),
            workTime: 1,
            name: 'BurnWood',
            storage: storageMock,
            hive: { name: 'Hive1' }
        }
        
        char.assignedAlveolus = alveolus as any
        
        // Use default scriptsContext which has all scripts loaded
        const context = char.scriptsContext as any;
        void context; // Trigger loading

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

        // Scripts are loaded by default via scriptsContext
        void context;
        
        const work = (context as any).work
        
        // Set invariant
        const plan = {
            type: 'work',
            job: 'transform',
            target: alveolus,
            invariant: () => true,
            urgency: 1,
            fatigue: 0,
        }

        const execution = work.transform(plan)
        
        let result = execution.run(context)
        let loops = 0
        while (result && result.type === 'yield' && loops < 100) {
            char.update(0.1)
            result = execution.run(context)
            loops++
        }
        
        if (loops >= 100) throw new Error('Transform stuck in loop')
        
        expect(storageMock.reserve).toHaveBeenCalled()
        expect(storageMock.allocate).toHaveBeenCalled()

        // Persistence check
        const saveState = game.saveGameData()
        const game2 = new Game({ boardSize: 12, terrainSeed: 555, characterCount: 0 })
        await game2.loaded
        game2.loadGameData(saveState)
        const char2 = game2.population.character(char.uid)
        expect(char2).toBeDefined()
    })
})
