import { describe, it, expect } from 'vitest'
import { TestEngine } from '@app/test-engine'
import { batch } from 'mutts'
import type { SaveState } from '$lib/game'

describe('Atomicity & Environment Investigation', () => {
    
    // Setup identical to gather_convey.test.ts
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

    const scenario: Partial<SaveState> = {
        hives: [{
            name: 'GatherHive',
            alveoli: [
                { coord: [0, 0], alveolus: 'gather', goods: {} },
                { coord: [1, 0], alveolus: 'storage', goods: {} }
            ]
        }],
        freeGoods: [
            { goodType: 'berries', position: { q: 0, r: 1 } },
            { goodType: 'berries', position: { q: 0, r: 1 } }
        ]
    };

    /**
     * Helper to run the simulation
     * @param mode 'batched' wraps the tick in a batch (simulating zoned rAF). 'unbatched' runs tick raw (simulating disabled rAF).
     */
    async function runSimulation(mode: 'batched' | 'unbatched') {
        const { engine, game, spawnWorker } = await setupEngine();
        engine.loadScenario(scenario);
        
        const gathererTile = game.hex.getTile({ q: 0, r: 0 });
        const gatherer = gathererTile?.content;
        const storageTile = game.hex.getTile({ q: 1, r: 0 });
        const storage = storageTile?.content?.storage;
        
        // Manual need for berries
        if (gatherer?.hive) gatherer.hive.manualNeeds = { berries: 10 };
        
        spawnWorker({ q: 0, r: 0 });
        spawnWorker({ q: 1, r: 0 }); // Worker at storage to complete convey
        
        // Run loop
        // 40 seconds total
        // engine.tick(1.0) advances 1.0s. It calls step(0.1) 10 times.
        // If we want to simulate batch-per-step or batch-per-tick-call.
        // Let's do batch-per-step manually.
        const dt = 0.1;
        const totalSteps = 40 / dt; // 400 steps
        
        for (let i = 0; i < totalSteps; i++) {
             if (mode === 'batched') {
                batch(() => {
                    engine.tick(dt, dt); // tick(0.1) advances 0.1s using 0.1s step
                });
            } else {
                engine.tick(dt, dt);
            }

        }

        let freeBerries = 0;
        for (const list of game.hex.freeGoods.goods.values()) {
            freeBerries += list.filter(fg => fg.goodType === 'berries').length;
        }

        const workerBerries = Array.from((game.population as any).characters.values()).reduce((acc: number, char: any) => acc + (char.inventory?.stock?.berries || 0), 0);

        // Re-fetch storage to ensure we have the latest instance
        const finalTile = game.hex.getTile({ q: 1, r: 0 });
        const finalContent = finalTile?.content as any;
        const finalStorage = finalContent?.storage;
        const gathererStorage = gatherer?.storage;
        
        console.log(`[Test] Mode ${mode} | Total Berries on Board:
            Gatherer: ${gathererStorage?.stock.berries || 0}
            Storage: ${finalStorage?.stock.berries || 0}
            Free: ${freeBerries}
            Workers: ${workerBerries}
            Total: ${(gathererStorage?.stock.berries || 0) + (finalStorage?.stock.berries || 0) + freeBerries + workerBerries}
        `);



        return {
            gathererStock: gathererStorage?.stock.berries || 0,
            storageStock: finalStorage?.stock.berries || 0
        };
    }

    it('should work when batched (Test/Zoned simulation)', async () => {
        const result = await runSimulation('batched');
        expect(result.storageStock).toBeGreaterThan(0);
    });

    it('should work when unbatched (Browser simulation - currently works due to Fix)', async () => {
        const result = await runSimulation('unbatched');
        expect(result.storageStock).toBeGreaterThan(0);
    });

});
