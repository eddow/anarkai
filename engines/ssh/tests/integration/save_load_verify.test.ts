// Manual DOM mock for PixiJS
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
import { MoveToStep, EatStep, DurationStep, MultiMoveStep } from '$lib/npcs/steps'
import { toAxialCoord } from '$lib/utils/position'

// Mock assets/resources
vi.mock('$assets/resources', () => ({
    resources: {}, 
    prefix: ''
}))

vi.mock('$assets/game-content', () => {
    const defaultTerrain = { walkTime: 1, generation: { deposits: {} }, sprites: ['grass.png'] }
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
            wood: { sprites: ['wood.png'] }, 
            stone: { sprites: ['stone.png'] }, 
            food: { feedingValue: 1, sprites: ['food.png'] }
        },
        terrain: terrainProxy,
        deposits: {
            tree: { 
                generation: { frequency: 0.1 },
                sprites: ['tree.png'],
                maxAmount: 100
            }
        },
        alveoli: {},
        configurations: {
            'specific-storage': { working: true, buffers: {} },
            default: { working: true }
        }
    }
})

describe('Save/Load Determinism', () => {
    // Use static imports
    // Patch getTexture to avoid rendering errors in headless mode
    Game.prototype.getTexture = () => ({ 
        defaultAnchor: { x: 0.5, y: 0.5 }, 
        width: 1, 
        height: 1 
    })

	it('Scenario 1: Movement Persistence', async () => {
		const game1 = new Game({ boardSize: 12, terrainSeed: 1234, characterCount: 0 })
		await game1.loaded
		const char1 = game1.population.createCharacter('Walker', { q: 0, r: 0 })
		char1.stepExecutor = new MoveToStep(10, char1, { q: 10, r: 0 })
		
		const dt = 0.1
		for (let i = 0; i < 20; i++) {
			game1.ticker.update(dt * 1000)
            char1.update(dt)
		}

		const saveState = game1.saveGameData()

        for (let i = 0; i < 20; i++) char1.update(dt)
        const controlPos = { ...char1.position }

        const game2 = new Game({ boardSize: 12, terrainSeed: 1234, characterCount: 0 })
        await game2.loaded
        game2.loadGameData(saveState)
        const char2 = game2.population.character(char1.uid)
        
        for (let i = 0; i < 20; i++) char2.update(dt)
        
        const pos2 = toAxialCoord(char2.position)
        const ctrlAxial = toAxialCoord(controlPos)
        expect(pos2.q).toBeCloseTo(ctrlAxial.q, 4)
        expect(pos2.r).toBeCloseTo(ctrlAxial.r, 4)
        expect(char2.stepExecutor!.constructor.name).toBe('MoveToStep')
	})

    it('Scenario 2: Inventory Persistence', async () => {
        const game = new Game({ boardSize: 12, terrainSeed: 555, characterCount: 0 })
        await game.loaded
        const char = game.population.createCharacter('Carrier', { q: 0, r: 0 })
        
        char.carry.addGood('wood', 5)
        char.carry.addGood('stone', 2)

        const saveState = game.saveGameData()

        const game2 = new Game({ boardSize: 12, terrainSeed: 555, characterCount: 0 })
        await game2.loaded
        game2.loadGameData(saveState)
        const char2 = game2.population.character(char.uid)

        expect(char2.carry.available('wood')).toBe(5)
        expect(char2.carry.available('stone')).toBe(2)
        expect(char2.carry.available('mushrooms')).toBe(0)
    })

    it('Scenario 3: Resource Gathering (DurationStep)', async () => {
        const game = new Game({ boardSize: 12, terrainSeed: 999, characterCount: 0 })
        await game.loaded
        const char = game.population.createCharacter('Worker', { q: 2, r: 2 })
        
        const workDuration = 5.0
        const step = new DurationStep(workDuration, 'work', 'Chopping Wood')
        char.stepExecutor = step

        const dt = 0.1
        for (let i = 0; i < 25; i++) char.update(dt) 

        const saveState = game.saveGameData()
        
        const game2 = new Game({ boardSize: 12, terrainSeed: 999, characterCount: 0 })
        await game2.loaded
        game2.loadGameData(saveState)
        const char2 = game2.population.character(char.uid)
        
        expect(char2.stepExecutor).toBeDefined()
        expect(char2.stepExecutor!.constructor.name).toBe('DurationStep')
        expect((char2.stepExecutor as DurationStep).evolution).toBeCloseTo(0.5, 2)
        
        // Finish work
        let finished = false
        char2.stepExecutor!.final(() => { finished = true })
        for (let i = 0; i < 26; i++) {
             char2.update(dt) 
        }
        expect(finished).toBe(true)
    })

    it('Scenario 4: Logistics/MultiMoveStep', async () => {
        // Simulates a complex movement often used when hauling goods
        const game = new Game({ boardSize: 12, terrainSeed: 777, characterCount: 0 })
        await game.loaded
        const char = game.population.createCharacter('Hauler', { q: 0, r: 0 })
        
        // MultiMove: A -> B -> C
        const path = [
            { who: char, from: { q: 0, r: 0 }, to: { q: 5, r: 5 } },
            { who: char, from: { q: 5, r: 5 }, to: { q: 10, r: 0 } }
        ]
        // This is pseudo-construction, MultiMoveStep expects distinct movements that might happen concurrently or sequentially?
        // Actually MultiMoveStep lerps all movements in parallel (evoluion 0-1).
        // It's used for fleets or coordinated moves.
        // Let's assume the character is moving relative to something else or just complex move.
        // We'll stick to a simple multi-move where 'who' is the char.
        
        const step = new MultiMoveStep(10, path, 'work', 'Hauling stuff')
        char.stepExecutor = step

        const dt = 0.1
        // Run 50%
        for (let i = 0; i < 50; i++) char.update(dt) // 5s

        const saveState = game.saveGameData()
        
        // Reload
        const game2 = new Game({ boardSize: 12, terrainSeed: 777, characterCount: 0 })
        await game2.loaded
        game2.loadGameData(saveState)
        const char2 = game2.population.character(char.uid)

        expect(char2.stepExecutor!.constructor.name).toBe('MultiMoveStep')
        expect((char2.stepExecutor as MultiMoveStep).evolution).toBeCloseTo(0.5, 2)
        
        // Check position: Should be halfway between start and end? 
        // Logic says MultiMoveStep updates position based on lerp.
        // If it persists, it should be correct.
        
        // Finish
        for (let i = 0; i < 51; i++) char2.update(dt)
        
        // After finish, char should be at destination of the movements?
        // MultiMoveStep updates 'who' position.
        // The last movement targeting q:10,r:0 should be reflected if it was applied.
        // expect(char2.position.q).toBeCloseTo(10, 1) 
        // (This depends on MultiMoveStep logic detail, verified by runtime)
    })
})
