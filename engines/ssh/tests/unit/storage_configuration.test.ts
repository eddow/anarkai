import { describe, it, expect, vi } from 'vitest'
import { StorageAlveolus } from '$lib/game/hive/storage'
import { SlottedStorage } from '$lib/game/storage/slotted-storage'

// Mock dependencies
vi.mock('$assets/game-content', () => ({
    alveoli: { 
        storage: { action: { type: 'storage', capacity: 10, slots: 5 } } 
    },
    deposits: {},
    goods: { wood: {}, stone: {}, berries: {} },
    terrain: {}
}));

// We need to set the prototype action for StorageAlveolus to work in tests
// since it reads from new.target.prototype
(StorageAlveolus.prototype as any).action = { type: 'storage', capacity: 10, slots: 5 };

describe('StorageAlveolus Configuration', () => {
    const mockTile = {
        position: { q: 0, r: 0 },
        board: { game: { random: () => 0.5 } },
        log: () => {}
    } as any

    it('should respect whitelist (only) mode', () => {
        const alveolus = new StorageAlveolus(mockTile)
        alveolus.storageMode = 'only'
        alveolus.storageExceptions = ['wood']

        expect(alveolus.canTake('wood', ['1-store', 'store'])).toBe(true)
        expect(alveolus.canTake('stone', ['1-store', 'store'])).toBe(false)
    })

    it('should respect blacklist (all-but) mode', () => {
        const alveolus = new StorageAlveolus(mockTile)
        alveolus.storageMode = 'all-but'
        alveolus.storageExceptions = ['stone']

        expect(alveolus.canTake('wood', ['1-store', 'store'] as any)).toBe(true)
        expect(alveolus.canTake('stone', ['1-store', 'store'] as any)).toBe(false)
    })

    it('should prioritize buffer over acceptance filter', () => {
        const alveolus = new StorageAlveolus(mockTile)
        alveolus.storageMode = 'only'
        alveolus.storageExceptions = [] // Accepts nothing
        alveolus.storageBuffers = { stone: 1 } // Buffer 1 slot (10 pieces)

        // Even if not in whitelist, it should accept because it's under buffer
        expect(alveolus.canTake('stone', ['1-store', 'store'] as any)).toBe(true)
        
        // Wood is still rejected
        expect(alveolus.canTake('wood', ['1-store', 'store'] as any)).toBe(false)
    })

    it('should stop accepting buffered good once buffer is met if not in whitelist', () => {
        const alveolus = new StorageAlveolus(mockTile)
        alveolus.storageMode = 'only'
        alveolus.storageExceptions = []
        alveolus.storageBuffers = { stone: 1 } // 1 slot = 10 pieces

        // Add 10 stone
        alveolus.storage.addGood('stone', 10)
        
        // Now it should NOT take more stone because it's not in whitelist
        expect(alveolus.canTake('stone', ['1-store', 'store'] as any)).toBe(false)
    })

    it('should advertise buffers as demand', () => {
        const alveolus = new StorageAlveolus(mockTile)
        alveolus.storageBuffers = { wood: 1 } // 1 slot
        
        const relations = alveolus.workingGoodsRelations
        expect(relations['wood']).toMatchObject({ advertisement: 'demand', priority: '1-buffer' })
    })

    it('should calculate pieces correctly for SlottedStorage buffers', () => {
        const alveolus = new StorageAlveolus(mockTile)
        // Def has capacity 10 per slot
        expect(alveolus.storage).toBeInstanceOf(SlottedStorage)
        expect((alveolus.storage as SlottedStorage).maxQuantityPerSlot).toBe(10)

        alveolus.storageBuffers = { wood: 2 } // 2 slots = 20 pieces
        
        // 15 pieces is under 20, should accept
        alveolus.storage.addGood('wood', 15)
        expect(alveolus.canTake('wood', ['1-store', 'store'] as any)).toBe(true)

        // 20 pieces is exactly buffer, if not in whitelist should reject
        alveolus.storage.addGood('wood', 5)
        alveolus.storageMode = 'only'
        alveolus.storageExceptions = []
        expect(alveolus.canTake('wood', ['1-store', 'store'] as any)).toBe(false)
    })
})
