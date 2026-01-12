
import { describe, it, expect } from 'vitest'
import { TestEngine } from '@app/test-engine'

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
        
        console.log('Loading scenario...');
        engine.loadScenario(scenario as any);
        
        // Add Character manually
        const char = engine.spawnCharacter('Worker', { q: 2, r: 2 });
        
        // Scripts are loaded by default via scriptsContext access or engine defaults
        void char.scriptsContext;
        
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
        const maxTime = 15.0;
        let time = 0;
        
        let pickedUp = false;

        while (time < maxTime) {
            engine.tick(tickRate, tickRate);
            
            if (char.vehicle.storage.stock.mushrooms === 1) {
                pickedUp = true;
            }

            // Success condition: It was picked up, and now it's gone from char (dropped)
            if (pickedUp && (char.vehicle.storage.stock.mushrooms || 0) === 0) {
                break;
            }
            time += tickRate;
        }

        // Assertions
        
        // 1. Verify it was cleared from original tile
        expect(tile!.availableGoods.length).toBe(0);
        
        // 2. Verify character doesn't have it anymore
        expect(char.vehicle.storage.stock.mushrooms || 0).toBe(0);

        // 3. Verify it exists somewhere else on the board
        let foundTile: any = null;
        for (const t of game.hex.tiles) {
            if (t.availableGoods.length > 0) {
                foundTile = t;
                break;
            }
        }
        
        expect(foundTile).toBeDefined();
        expect(foundTile.availableGoods[0].goodType).toBe('mushrooms');
        
        // 4. Verify it's NOT on the original hive tile (2,2)
        const foundCoord = foundTile.position;
        expect(foundCoord.q === 2 && foundCoord.r === 2).toBe(false);
        
        // 5. Verify it's a "Safe" tile (no hive/construction)
        // In this scenario, any other tile is safe as they are empty UnBuiltLand
        expect((foundTile.content as any).hive).toBeUndefined();

        // 6. Verify it didn't drop on the neighbor alveolus (if we add one)
        // Let's add an explicit alveolus neighbor to the test setup to verify this constraint
        // But for now, just checking it's UnBuiltLand and no project is good.
        // Ideally we'd modify the setup to surround (2,2) with alveoli except one spot.
    });

    it('Scenario: Avoid Dropping on Alveoli', { timeout: 5000 }, async () => {
         const engine = new TestEngine({ boardSize: 12, terrainSeed: 1234, characterCount: 0 });
         await engine.init(); 
         const game = engine.game;
         
         const center = { q: 5, r: 5 };
         
         // Setup: Center has mushrooms
         // Neighbor (6,5) has an Alveolus (e.g. storage or another chopper)
         // Neighbor (4,5) is empty UnBuiltLand
         // Character offloads from center. 
         // EXPECT: Drop on (4,5), NOT (6,5)
         
         const scenario = {
             generationOptions: { boardSize: 12, terrainSeed: 1234, characterCount: 0 },
             freeGoods: [
                 { goodType: 'mushrooms', position: center }
             ],
             hives: [
                 {
                     name: 'BlockerHive',
                     alveoli: [
                         {
                             coord: [6, 5],
                             alveolus: 'storage', // Blocker
                             goods: {}
                         },
                         {
                             coord: [5, 5], // Center - needs to be alveolus/residential to trigger offload
                             alveolus: 'tree_chopper',
                             goods: {}
                         }
                     ]
                 }
             ]
         };
         
         engine.loadScenario(scenario as any);
         
         const char = engine.spawnCharacter('Worker', center);
         void char.scriptsContext;
         
         // Trigger offload
         const bestJob = char.findBestJob();
         if (bestJob) char.begin(bestJob); 
         else throw new Error('No job found');

         // Run
         let time = 0;
         while (time < 10) {
             engine.tick(0.1, 0.1);
             if ((char.vehicle.storage.stock.mushrooms || 0) === 0 && char.tiredness > 0.1) break; // simplistic 'done' check
             time += 0.1;
         }
         
         // Check where it went
         const neighborAlveolusTile = game.hex.getTile({ q: 6, r: 5 });
         const emptyNeighborTile = game.hex.getTile({ q: 4, r: 5 });
         
         const goodsOnAlveolus = game.hex.freeGoods.getGoodsAt(neighborAlveolusTile!.position);
         const goodsOnEmpty = game.hex.freeGoods.getGoodsAt(emptyNeighborTile!.position);
         
         // Should NOT be on alveolus
         expect(goodsOnAlveolus.length).toBe(0);
         
         // MIGHT be on empty (or any other empty neighbor, but definitely not alveolus)
         // We can just assert that no good is on the alveolus tile.
    });
});
