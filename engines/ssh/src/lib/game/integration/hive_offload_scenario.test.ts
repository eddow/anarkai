
import { describe, it, expect } from 'vitest'
import { TestEngine } from '../../../test-engine'

describe('Hive Offload Scenario', () => {

    it('Scenario: Offload Mushroom', { timeout: 5000 }, async () => {
        const engine = new TestEngine({ boardSize: 12, terrainSeed: 1234, characterCount: 0 });
        await engine.init(); 
        const game = engine.game;

        // Define Scenario
        const scenario = {
            generationOptions: { boardSize: 12, terrainSeed: 1234, characterCount: 0 },
            freeGoods: [
                { goodType: 'mushrooms', position: { q: 2, r: 2 } }
            ],
            hives: [
                {
                    name: 'TestHive',
                    alveoli: [
                        {
                            coord: [2, 2],
                            alveolus: 'tree_chopper',
                            goods: {}
                        }
                    ]
                }
            ]
        };
        
        // Helper to load scripts
        const scripts: Record<string, string> = {};
        const files = ['work.npcs', 'inventory.npcs', 'walk.npcs', 'selfCare.npcs'];
        for (const file of files) {
             scripts['/scripts/' + file] = engine.loadScript(file);
        }
        
        // Import loadNpcScripts to inject
        const { loadNpcScripts } = await import('../npcs/scripts');
        
        console.log('Loading scenario...');
        engine.loadScenario(scenario as any);
        
        // Add Character manually
        const char = engine.spawnCharacter('Worker', { q: 2, r: 2 });
        
        // Inject scripts
        loadNpcScripts(scripts, char.scriptsContext);
        
        // Verify Initial State
        const tile = game.hex.getTile({ q: 2, r: 2 });
        expect(tile).toBeDefined();
        expect(tile?.availableGoods.length).toBe(1);
        expect(tile?.availableGoods[0].goodType).toBe('mushrooms');
        expect((tile?.content as any).hive).toBeDefined();

        // Manual Job Check
        const bestJob = char.findBestJob();
        if (bestJob) {
           char.begin(bestJob);
        } else {
           throw new Error('Character failed to find offload job');
        }

        // Run Loop
        // Run 10 seconds approx? Original test ran until explicit break.
        // We can just loop tick manually if condition check is needed mid-loop, 
        // or use tick() if we are confident.
        // Let's mimic the loop-break check:
        const tickRate = 0.1;
        const maxTime = 10.0;
        let time = 0;
        
        while (time < maxTime) {
            engine.tick(tickRate, tickRate);
            
            // Check success
            if (tile!.availableGoods.length === 0 && char.vehicle.storage.stock.mushrooms === 1) {
                break;
            }
            time += tickRate;
        }

        // Assertions
        expect(tile!.availableGoods.length).toBe(0);
        expect(char.vehicle.storage.stock.mushrooms).toBe(1);
    });
});
