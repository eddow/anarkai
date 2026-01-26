
import { describe, it, expect } from 'vitest'
import { TestEngine } from 'ssh/src/test-engine'
import { SaveState } from 'ssh/src/lib/game';
import { axial } from 'ssh/src/lib/utils/axial';
import type { StorageAlveolus } from 'ssh/src/lib/hive/storage';

describe('Storage Buffering', () => {
    
    async function setupEngine() {
        // Fix: Provide required characterCount
        const engine = new TestEngine({ boardSize: 12, terrainSeed: 1234, characterCount: 0 });
        await engine.init();
        
        function spawnWorker(coord: { q: number, r: number }) {
            const char = engine.spawnCharacter('Worker', coord);
            char.role = 'worker';
            // Force worker to be available
            void char.scriptsContext;
            const action = char.findAction();
            if (action) char.begin(action);
            return char;
        }

        return { engine, game: engine.game, spawnWorker };
    }

    it('should allow configuring storage to buffer goods, triggering gathering', { timeout: 15000 }, async () => {
        const { engine, game, spawnWorker } = await setupEngine();

        // Setup: 
        // 0,0: Storage (start empty)
        // 1,0: Gatherer
        // 2,0: Free wood (5 units)
        const scenario: Partial<SaveState> = {
            hives: [
                {
                    name: 'GatherHive',
                    alveoli: [
                        { 
                            coord: [0, 0],
                            alveolus: 'storage',
                            goods: {}
                        },
                        { 
                            coord: [1, 0], 
                            alveolus: 'gather', // Fix: 'gather' instead of 'gatherer'
                            goods: {}
                        }
                    ]
                }
            ],
            // Add free goods at 2,0
            freeGoods: [
                { position: { q: 2, r: 0 }, goodType: 'wood' },
                { position: { q: 2, r: 0 }, goodType: 'wood' },
                { position: { q: 2, r: 0 }, goodType: 'wood' },
                { position: { q: 2, r: 0 }, goodType: 'wood' },
                { position: { q: 2, r: 0 }, goodType: 'wood' },
                { position: { q: 2, r: 0 }, goodType: 'wood' }
            ],
            tiles: [
                { coord: [2, 0] as [number, number], terrain: 'grass' }
            ]
        };
        
        engine.loadScenario(scenario);
        
        const storageTile = game.hex.getTile({ q: 0, r: 0 });
        const storageAlveolus = storageTile?.content as StorageAlveolus;
        const gathererTile = game.hex.getTile({ q: 1, r: 0 });
        const gathererAlveolus = gathererTile?.content as any;
        
        // Spawn worker for gatherer
        const gathererWorker = spawnWorker({ q: 1, r: 0 });
        gathererWorker.assignedAlveolus = gathererAlveolus;
        gathererAlveolus.assignedWorker = gathererWorker;

        // Verify setup
        expect(storageAlveolus.storage.available('wood')).toBe(0);
        
        // (Free goods API might vary, assuming scenario loaded correctly)

        // Step 1: Run for a while. Without buffering, nothing should happen.
        // Storage advertises '0-store', Hive ignores it. Gatherer sees no need.
        for (let i = 0; i < 100; i++) {
            engine.tick(0.1);
            await new Promise(resolve => setTimeout(resolve, 0));
            if (gathererWorker.stepExecutor?.constructor.name === 'GatherStep') {
                // If it starts gathering, that's unexpected for now (unless default behavior changes)
                console.log('UNEXPECTED: Gatherer started gathering without buffering config');
            }
        }

        expect(storageAlveolus.storage.available('wood')).toBe(0);
        expect(gathererWorker.stepExecutor?.constructor.name).not.toBe('GatherStep');

        console.log('Confirmed: No gathering with default storage config.');

        // Step 2: Configure storage to buffer
        // usage: storage.buffers.set('wood', 10);
        storageAlveolus.setBuffers({ wood: 10 });
        
        console.log('Configured storage to buffer 10 wood');
        console.log('Storage GoodsRelations:', JSON.stringify(storageAlveolus.goodsRelations));
        console.log('Hive Needs:', JSON.stringify(storageAlveolus.hive.needs));

        // Step 3: Run again. Now expecting gathering.
        let gathered = false;
        // Increase timeout/ticks as gathering + walking + conveying takes time
        for (let i = 0; i < 1000; i++) {
            engine.tick(0.1);
            await new Promise(resolve => setTimeout(resolve, 0));
            
            if (i % 50 === 0) {
                 const stepName = gathererWorker.stepExecutor?.constructor.name;
                 console.log(`Tick ${i}: Gatherer state: ${stepName}, Storage: ${storageAlveolus.storage.available('wood')}`);
            }

            // Check if wood arrived in storage
            if (storageAlveolus.storage.available('wood') > 0) {
                gathered = true;
                break;
            }
        }
        expect(gathered).toBe(true);
    });
    
    it('should allow configuring woodpile (SpecificStorage) to buffer goods', { timeout: 15000 }, async () => {
        const { engine, game, spawnWorker } = await setupEngine();

        const scenario: Partial<SaveState> = {
            hives: [
                {
                    name: 'WoodpileHive',
                    alveoli: [
                        { 
                            coord: [0, 0],
                            alveolus: 'woodpile', // SpecificStorage
                            goods: {}
                        },
                        { 
                            coord: [1, 0], 
                            alveolus: 'gather',
                            goods: {}
                        }
                    ]
                }
            ],
            freeGoods: [
                { position: { q: 2, r: 0 }, goodType: 'wood' },
                { position: { q: 2, r: 0 }, goodType: 'wood' },
                { position: { q: 2, r: 0 }, goodType: 'wood' },
                { position: { q: 2, r: 0 }, goodType: 'wood' },
                { position: { q: 2, r: 0 }, goodType: 'wood' }
            ]
        };
        
        engine.loadScenario(scenario);
        
        const woodpileTile = game.hex.getTile({ q: 0, r: 0 });
        const woodpileAlveolus = woodpileTile?.content as StorageAlveolus;

        const gathererTile = game.hex.getTile({ q: 1, r: 0 });
        const gathererAlveolus = gathererTile?.content as any;
        
        const gathererWorker = spawnWorker({ q: 1, r: 0 });
        gathererWorker.assignedAlveolus = gathererAlveolus;
        gathererAlveolus.assignedWorker = gathererWorker;

        // Configure woodpile to buffer
        woodpileAlveolus.setBuffers({ wood: 10 });
        
        let gathered = false;
        for (let i = 0; i < 1000; i++) {
            engine.tick(0.1);
            await new Promise(resolve => setTimeout(resolve, 0));
            if (woodpileAlveolus.storage.available('wood') > 0) {
                gathered = true;
                break;
            }
        }
        expect(gathered).toBe(true);
    });
});
