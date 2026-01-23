
import { describe, it, expect } from 'vitest'
import { TestEngine } from 'ssh/src/test-engine'
import { SaveState } from 'ssh/src/lib/game';
import { axial } from 'ssh/src/lib/utils/axial';

describe('Convey Stall Reproduction', () => {
    
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

    it('NPC should wake up when goods arrive at gate', { timeout: 15000 }, async () => {
        const { engine, game, spawnWorker } = await setupEngine();

        // Setup: Two alveoli. 0,0 is storage, 1,0 is sawmill.
        // Sawmill starts empty.
        const scenario: Partial<SaveState> = {
            hives: [
                {
                    name: 'TestHive',
                    alveoli: [
                        { 
                            coord: [0, 0],
                            alveolus: 'storage',
                            goods: {}
                        },
                        { 
                            coord: [1, 0], 
                            alveolus: 'sawmill',
                            goods: {}
                        }
                    ]
                }
            ]
        };
        
        engine.loadScenario(scenario);
        
        const sawmillTile = game.hex.getTile({ q: 1, r: 0 });
        const sawmill = sawmillTile?.content as any;
        const storageTile = game.hex.getTile({ q: 0, r: 0 });
        const storage = storageTile?.content as any;
        
        // Spawn both workers FIRST
        const char = spawnWorker({ q: 1, r: 0 });
        char.name = 'SawmillWorker';
        char.assignedAlveolus = sawmill;
        sawmill.assignedWorker = char;

        const storageWorker = spawnWorker({ q: 0, r: 0 });
        storageWorker.name = 'StorageWorker';
        storageWorker.assignedAlveolus = storage;
        storage.assignedWorker = storageWorker;

        // Step 1: Wait for both NPCs to finish initial wandering and be idle (no stepExecutor)
        let totalWait = 0;
        while ((char.stepExecutor || storageWorker.stepExecutor) && totalWait < 200) {
            engine.tick(0.1);
            totalWait++;
        }
        console.log('Both workers idle after', totalWait * 0.1, 's');

        // Step 2: Add wood to storage at 0,0.
        // storageTile and storage are already defined above
        
        // Verify gate exists
        const gate = storageTile?.borderWith({ q: 1, r: 0 })?.content;
        console.log('Gate content between 0,0 and 1,0:', gate?.constructor.name);
        
        console.log('Adding wood to storage at 0,0');
        storage.storage.addGood('wood', 1);

        // Debug: check if storage worker sees aGoodMovement
        const movements = storage.aGoodMovement;
        console.log('Storage aGoodMovement present:', !!movements);
        if (movements && movements.length > 0) {
            const mg = movements[0];
            const pathArr = Array.from(mg.path);
            console.log('Movement path length:', pathArr.length);
            console.log('Movement hops:', pathArr.map((p: any) => axial.key(p)));
        }
        
        console.log('Storage incomingGoods:', storage.incomingGoods);
        console.log('Sawmill aGoodMovement:', sawmill.aGoodMovement);
        console.log('Sawmill incomingGoods:', sawmill.incomingGoods);

        // Step 3: Tick until storage worker actually starts the MultiMoveStep (actual conveyance)
        let startedConvey = false;
        for (let i = 0; i < 300; i++) {
            engine.tick(0.1);
            const executorName = storageWorker.stepExecutor?.constructor.name;
            if (executorName === 'MultiMoveStep') {
                startedConvey = true;
                break;
            }
            if (i % 20 === 0) {
                const hive = (sawmill as any).hive;
                console.log(`Tick ${i}, storage executor: ${executorName}, movingGoods:`, Array.from(hive.movingGoods.keys()).map((k: any) => axial.key(k)));
            }
        }
        expect(startedConvey).toBe(true);
        console.log('Storage worker started MultiMoveStep');

        // Step 4: Tick until good arrives at gate (incomingGoods should be true)
        let incomingFound = false;
        for (let i = 0; i < 100; i++) {
            if (sawmill.incomingGoods && !sawmill.aGoodMovement) {
                incomingFound = true;
                break;
            }
            engine.tick(0.1);
            if (i % 20 === 0) {
                console.log(`Tick ${i} after move started, sawmill incoming: ${sawmill.incomingGoods}, sawmill aGoodMovement: ${!!sawmill.aGoodMovement}`);
            }
        }
        
        expect(incomingFound).toBe(true);
        console.log('State reached: incomingGoods=true, aGoodMovement=false');

        // Step 5: Tick until sawmill worker picks up the convey job
        // It should either start waiting OR start conveying immediately
        let sawmillActive = false;
        for (let i = 0; i < 200; i++) {
            engine.tick(0.1);
            const executorName = char.stepExecutor?.constructor.name;
            const description = (char.stepExecutor as any)?.descriptionText;
            if (description === 'wait.incoming-goods' || executorName === 'MultiMoveStep' || description === 'convey') {
                sawmillActive = true;
                break;
            }
            if (i % 20 === 0) {
                console.log(`Tick ${i}, sawmill executor: ${executorName}, description: ${description}`);
            }
        }
        
        expect(sawmillActive).toBe(true);
        console.log('Sawmill worker woke up and reacted to incoming goods (conveying or waiting)');
    });
});
