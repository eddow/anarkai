import { vi } from 'vitest';

export function loadStandardMocks() {
    // Mock $assets/resources
    vi.mock('$assets/resources', () => ({ resources: {}, prefix: '' }));

    // Mock $assets/game-content
    vi.mock('$assets/game-content', async () => {
        return {
            vehicles: {
                'by-hands': { storage: { slots: 10, capacity: 100 }, transferTime: 1 },
                worker: { speed: 1, capacity: 10, transferTime: 1 },
            },
            goods: { 
                wood: {}, 
                stone: {}, 
                food: { feedingValue: 1 },
                mushrooms: { feedingValue: 1 } 
            },
            terrain: new Proxy({}, { get: () => ({ walkTime: 1, generation: { deposits: {} }, sprites: ['grass.png'] }) }),
            deposits: { tree: { generation: { frequency: 0.1 }, maxAmount: 100 } },
            alveoli: { 'tree_chopper': { action: { type: 'harvest', deposit: 'tree', output: { wood: 1 } } } }
        }
    });
}
