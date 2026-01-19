import { describe, it, expect } from 'vitest'
import { SlottedStorage } from '$lib/game/storage/slotted-storage'

describe('SlottedStorage Reactivity', () => {
    it('updates availables when reserved (bug reproduction)', () => {
        const storage = new SlottedStorage(2, 10);

        // 1. Allocate a slot (creates non-reactive slot in current implementation)
        const alloc = storage.allocate({ wood: 1 }, 'test');
        
        const slot = storage.slots.find(s => s && s.goodType === 'wood');
        expect(slot).toBeDefined();

        // 2. Fulfill it (quantity = 1).
        alloc.fulfill();

        // 3. Trigger array reactivity to refresh availables cache
        // We add another good to a different slot, modifying the array.
        storage.addGood('stone', 1);

        // 4. Check availables. Should be correct now.
        expect(storage.availables.wood).toBe(1);

        // 5. Reserve the wood.
        // If slot is non-reactive/stale, availables might remain 1.
        storage.reserve({ wood: 1 }, 'test-reserve');

        // Check fresh calc (available) - this always works
        expect(storage.available('wood')).toBe(0);

        // Check availables getter - this must match available()
        expect(storage.availables.wood || 0).toBe(0);
    });
});
