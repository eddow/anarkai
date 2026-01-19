import { describe, it, expect } from 'vitest'
import { TestEngine } from '@app/test-engine'
import { SaveState } from '$lib/game';

describe('Gatherer Conveying Integration', () => {
    
    async function setupEngine(options: any = { boardSize: 12, terrainSeed: 1234, characterCount: 0 }) {
        const engine = new TestEngine(options);
        await engine.init();
        
        function spawnWorker(coord: { q: number, r: number }) {
            const char = engine.spawnCharacter('Worker', coord);
            char.role = 'worker';
            void char.scriptsContext;
            
            const action = char.findAction();
            if (action) char.begin(action);
            
            return char;
        }

        return { engine, game: engine.game, spawnWorker };
    }

    it('Gatherer should gather goods and convey them to storage', { timeout: 15000 }, async () => {
        const { engine, game, spawnWorker } = await setupEngine();

        // Setup: Gatherer and Storage.
        // Free berries nearby.
        // Storage should demand berries (default behavior for empty storage with room).
        const scenario: Partial<SaveState> = {
            hives: [
                {
                    name: 'GatherHive',
                    alveoli: [
                        { 
                            coord: [0, 0],
                            alveolus: 'gather',
                            goods: {}
                        },
                        { 
                            coord: [1, 0], 
                            alveolus: 'storage', // Should accept berries
                            goods: {}
                        }
                    ]
                }
            ],
            freeGoods: [
                { goodType: 'berries', position: { q: 0, r: 1 } },
                { goodType: 'berries', position: { q: 0, r: 1 } },
                { goodType: 'berries', position: { q: 0, r: 1 } }
            ]
        };
        
        engine.loadScenario(scenario);
        
        const gathererTile = game.hex.getTile({ q: 0, r: 0 });
        const gatherer = gathererTile?.content;
        console.log('Gatherer tile content:', gatherer?.constructor.name, gatherer);

        const storageTile = game.hex.getTile({ q: 1, r: 0 });
        const storage = storageTile?.content?.storage;
        console.log('Storage tile content:', storageTile?.content?.constructor.name);
        
        expect(gatherer).toBeDefined();
        if (gatherer!.constructor.name === 'UnBuiltLand') {
            throw new Error('Gatherer alveolus was not created/placed correctly');
        }
        expect(storage).toBeDefined();
        
        // Add a manual need for berries so gatherer will collect them
        // (0-store priority demands from storage don't count as hive needs)
        const hive = gatherer?.hive;
        if (hive) {
            hive.manualNeeds = { berries: 10 };
        }
        
        // Spawn worker at gatherer
        spawnWorker({ q: 0, r: 0 });
        
        // Advance time
        // 1. Worker should gather berries -> Gatherer storage
        // 2. Gatherer should convey berries -> Storage Alveolus
        
        // Allow enough time for gathering and conveying
        for (let i = 0; i < 40; i++) {
            engine.tick(1.0);
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        const gathererStock = gatherer?.storage!.stock.berries || 0;
        const storageStock = storage?.stock.berries || 0;
        
        // We expect goods to end up in storage
        expect(storageStock).toBeGreaterThan(0);
        
        // We expect gatherer to be empty (or at least transferring)
        expect(gathererStock).toBe(0);

    });
});
