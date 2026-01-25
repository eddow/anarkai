import { describe, it, expect } from 'vitest'
import { TestEngine } from 'ssh/src/test-engine'
import { SaveState } from 'ssh/src/lib/game';
import { UnBuiltLand } from 'ssh/src/lib/board/content/unbuilt-land';

describe('Deadlock Reproduction', () => {

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

    it('Regression: should not deadlock in waitForIncomingGoods during heavy conveyance', { timeout: 60000 }, async () => {
        const { engine, game, spawnWorker } = await setupEngine();

        // Scenario:
        // Hive 1: [0,0] (Gatherer), [1,0] (Transit), [2,0] (Woodpile)
        const scenario: Partial<SaveState> = {
            hives: [
                {
                    name: 'MainHive',
                    alveoli: [
                        { coord: [0, 0], alveolus: 'gather', goods: {} },
                        { coord: [1, 0], alveolus: 'woodpile', goods: {} }
                    ]
                }
            ],
            freeGoods: []
        };

        engine.loadScenario(scenario);

        const gatherer = game.hex.getTile({ q: 0, r: 0 })!.content!;
        const woodpile = game.hex.getTile({ q: 1, r: 0 })!.content!.storage!;
        
        // Pre-fill gatherer storage with wood
        const woodCount = 10;
        if (gatherer.storage) {
            gatherer.storage.addGood('wood', woodCount);
        }

        // Set needs to trigger conveyance
        if (gatherer.hive) {
            gatherer.hive.manualNeeds = { wood: 50 };
        }

        // Add food berries to workers (manual inject to inventory)
        const setupWorker = (coord: { q: number, r: number }) => {
            const w = spawnWorker(coord);
            if (w.vehicle) {
                w.vehicle.storage.addGood('berries', 5);
            }
            return w;
        };

        const workers = [
            setupWorker({ q: 0, r: 0 }),
            setupWorker({ q: 1, r: 0 })
        ];

        // Helper to check progress
        const getWoodpileStock = () => woodpile.stock.wood || 0;
        
        console.log('Starting simulation...');
        let lastStock = 0;
        let noProgressTicks = 0;

        for (let i = 0; i < 4000; i++) {
            engine.tick(0.1);
            if (i % 100 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
                const currentStock = getWoodpileStock();
                if (currentStock === woodCount) {
                    console.log('Test Passed: All wood transferred successfully!');
                    break;
                }
                if (currentStock === lastStock) {
                    noProgressTicks++;
                    if (noProgressTicks > 20) { 
                         console.warn(`Progress stuck at ${currentStock}/${woodCount}`);
                         for (const w of workers) {
                             console.warn(`Worker ${w.name} step: ${w.currentAction?.step?.name}`);
                         }
                    }
                    if (noProgressTicks > 40) {
                         throw new Error('DEADLOCK DETECTED: Progress has ceased for a long time.');
                    }
                } else {
                    lastStock = currentStock;
                    noProgressTicks = 0;
                }
            }
        }
        
        console.log(`Final Woodpile Stock: ${getWoodpileStock()}`);
        expect(getWoodpileStock()).toBe(woodCount);



    });
});
